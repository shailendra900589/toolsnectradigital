"""
PDF operations service module.

This module provides various utilities for manipulating PDF files, including
merging, compressing, rotating, extracting/removing pages, and image extraction.
"""

from __future__ import annotations

import io
import re
import zipfile
from typing import List, Set, Tuple

import fitz  # PyMuPDF
from PIL import Image, ImageOps
import img2pdf

MAX_PDF_MERGE_FILES = 20
MAX_PDF_PAGES = 500


def _open_pdf(data: bytes) -> fitz.Document:
    """Open a PDF from bytes.
    
    Args:
        data: The PDF file content as bytes.
        
    Returns:
        fitz.Document: The loaded PyMuPDF document.
        
    Raises:
        fitz.FileDataError: If the provided bytes are not a valid PDF.
    """
    return fitz.open(stream=data, filetype="pdf")


def merge_pdfs(files: List[bytes]) -> bytes:
    """Merge multiple PDF files into a single PDF.

    Args:
        files: A list of PDF file contents as bytes.

    Returns:
        bytes: The merged PDF file content.

    Raises:
        ValueError: If no files are provided, too many files are provided,
            or if any single PDF exceeds the maximum allowed page count.
    """
    if not files:
        raise ValueError("No PDF files provided.")
    if len(files) > MAX_PDF_MERGE_FILES:
        raise ValueError(f"Too many files provided (maximum allowed is {MAX_PDF_MERGE_FILES}).")
        
    out_doc = fitz.open()
    try:
        for raw_data in files:
            with _open_pdf(raw_data) as src_doc:
                if src_doc.page_count > MAX_PDF_PAGES:
                    raise ValueError(f"One of the provided PDFs exceeds the maximum limit of {MAX_PDF_PAGES} pages.")
                out_doc.insert_pdf(src_doc)
        return out_doc.tobytes(deflate=True, garbage=4)
    finally:
        out_doc.close()


def compress_pdf(data: bytes) -> bytes:
    """Compress a PDF by downsampling its embedded images.

    Args:
        data: The original PDF file content.

    Returns:
        bytes: The compressed PDF file content.
    """
    doc = _open_pdf(data)
    
    try:
        for page in doc:
            for img_info in page.get_images():
                xref = img_info[0]
                try:
                    base_img = doc.extract_image(xref)
                    if not base_img: 
                        continue
                        
                    img_data = base_img["image"]
                    
                    # Compress the image using PIL
                    pil_img = Image.open(io.BytesIO(img_data))
                    if pil_img.mode in ("RGBA", "P"):
                        pil_img = pil_img.convert("RGB")
                    
                    out_buffer = io.BytesIO()
                    # Downsample to reduce file size
                    pil_img.save(out_buffer, format="JPEG", quality=40, optimize=True)
                    new_img_data = out_buffer.getvalue()
                    
                    # Only replace if the new image is smaller
                    if len(new_img_data) < len(img_data):
                        page.replace_image(xref, stream=new_img_data)
                except Exception:
                    # Silently ignore errors for individual images to ensure overall process completes
                    continue

        return doc.tobytes(deflate=True, garbage=4, clean=True)
    finally:
        doc.close()


def rotate_pdf(data: bytes, degrees: int) -> bytes:
    """Rotate all pages in a PDF by a specified angle.

    Args:
        data: The PDF file content.
        degrees: The rotation angle in degrees (90, 180, or 270 clockwise).

    Returns:
        bytes: The rotated PDF file content.

    Raises:
        ValueError: If the degrees provided are not 90, 180, or 270.
    """
    if degrees not in (90, 180, 270):
        raise ValueError("Rotation must be exactly 90, 180, or 270 degrees.")
        
    with _open_pdf(data) as doc:
        for i in range(doc.page_count):
            page = doc.load_page(i)
            new_rotation = (page.rotation + degrees) % 360
            page.set_rotation(new_rotation)
        return doc.tobytes(deflate=True, garbage=4)


def parse_page_numbers(spec: str, page_count: int) -> Set[int]:
    """Parse a page selection string into a set of 1-based page numbers.

    Args:
        spec: A string specifying page numbers (e.g., '1,3-5,8').
        page_count: The total number of pages in the document.

    Returns:
        Set[int]: A set of valid 1-based page numbers.
    """
    spec = spec.strip()
    if not spec:
        return set()
        
    compiled_pages: Set[int] = set()
    for part in re.split(r"[\s,;]+", spec):
        part = part.strip()
        if not part:
            continue
            
        if "-" in part:
            try:
                a, b = part.split("-", 1)
                lo, hi = int(a.strip()), int(b.strip())
                if lo > hi:
                    lo, hi = hi, lo
                for p in range(lo, hi + 1):
                    if 1 <= p <= page_count:
                        compiled_pages.add(p)
            except ValueError:
                continue
        else:
            try:
                p = int(part)
                if 1 <= p <= page_count:
                    compiled_pages.add(p)
            except ValueError:
                continue
                
    return compiled_pages


def extract_pages_pdf(data: bytes, pages_1based: Set[int]) -> bytes:
    """Create a new PDF containing only the specified pages.

    Args:
        data: The original PDF file content.
        pages_1based: A set of 1-based page numbers to extract.

    Returns:
        bytes: The new PDF containing only the extracted pages.

    Raises:
        ValueError: If no pages are selected or an invalid page number is provided.
    """
    if not pages_1based:
        raise ValueError("At least one page must be selected for extraction.")
        
    with _open_pdf(data) as src_doc:
        total_pages = src_doc.page_count
        for p in pages_1based:
            if p < 1 or p > total_pages:
                raise ValueError(f"Page {p} is out of range. Document has {total_pages} pages.")
                
        new_doc = fitz.open()
        try:
            for p in sorted(pages_1based):
                new_doc.insert_pdf(src_doc, from_page=p - 1, to_page=p - 1)
            return new_doc.tobytes(deflate=True, garbage=4)
        finally:
            new_doc.close()


def remove_pages_pdf(data: bytes, pages_to_remove: Set[int]) -> bytes:
    """Create a new PDF with the specified pages removed.

    Args:
        data: The original PDF file content.
        pages_to_remove: A set of 1-based page numbers to remove.

    Returns:
        bytes: The PDF with the specified pages excluded.

    Raises:
        ValueError: If attempting to remove all pages from the document.
    """
    with _open_pdf(data) as doc:
        total_pages = doc.page_count
        to_remove = {p for p in pages_to_remove if 1 <= p <= total_pages}
        
        if not to_remove:
            return doc.tobytes(deflate=True, garbage=4)
            
        new_doc = fitz.open()
        try:
            for i in range(total_pages):
                if (i + 1) not in to_remove:
                    new_doc.insert_pdf(doc, from_page=i, to_page=i)
                    
            if new_doc.page_count == 0:
                raise ValueError("Operation failed: cannot remove all pages from the document.")
                
            return new_doc.tobytes(deflate=True, garbage=4)
        finally:
            new_doc.close()


def split_pdf_each_page(data: bytes) -> List[Tuple[str, bytes]]:
    """Split a PDF into individual files for each page.

    Args:
        data: The PDF file content.

    Returns:
        List[Tuple[str, bytes]]: A list of tuples containing the generated filename 
            and the bytes for each individual page.

    Raises:
        ValueError: If the PDF exceeds the maximum page limit.
    """
    out_files: List[Tuple[str, bytes]] = []
    with _open_pdf(data) as doc:
        total_pages = doc.page_count
        if total_pages > MAX_PDF_PAGES:
            raise ValueError(f"PDF exceeds the maximum limit of {MAX_PDF_PAGES} pages.")
            
        for i in range(total_pages):
            single_page_doc = fitz.open()
            try:
                single_page_doc.insert_pdf(doc, from_page=i, to_page=i)
                filename = f"page-{i + 1:04d}.pdf"
                out_files.append((filename, single_page_doc.tobytes(deflate=True, garbage=4)))
            finally:
                single_page_doc.close()
                
    return out_files


def extract_text_pdf(data: bytes) -> str:
    """Extract all text from a PDF document.

    Args:
        data: The PDF file content.

    Returns:
        str: The extracted text across all pages.
    """
    text_parts: List[str] = []
    with _open_pdf(data) as doc:
        for i in range(doc.page_count):
            text_parts.append(doc.load_page(i).get_text())
            
    return "\n\n".join(text_parts)


def extract_images_zip(data: bytes) -> bytes:
    """Extract embedded images from a PDF and package them into a ZIP archive.

    Args:
        data: The PDF file content.

    Returns:
        bytes: The ZIP archive containing the extracted images.

    Raises:
        ValueError: If no embedded images are found in the PDF.
    """
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        with _open_pdf(data) as doc:
            img_idx = 0
            for page_idx in range(doc.page_count):
                for img_info in doc.get_page_images(page_idx):
                    xref = img_info[0]
                    base_image = doc.extract_image(xref)
                    img_bytes = base_image["image"]
                    ext = base_image.get("ext", "png")
                    
                    img_idx += 1
                    filename = f"p{page_idx + 1:04d}-img{img_idx:03d}.{ext}"
                    zf.writestr(filename, img_bytes)
                    
            if img_idx == 0:
                raise ValueError("No embedded images were found in this PDF.")
                
    return zip_buffer.getvalue()


def images_to_pdf(files: List[Tuple[bytes, str]]) -> bytes:
    """Convert multiple images into a single PDF document.

    Args:
        files: A list of tuples containing image bytes and original filenames.

    Returns:
        bytes: The generated PDF document.

    Raises:
        ValueError: If no images are provided, or if the number of images exceeds 200.
    """
    if not files:
        raise ValueError("At least one image must be provided.")
    if len(files) > 200:
        raise ValueError("Too many images provided (maximum 200).")

    img_buffers: List[io.BytesIO] = []
    for raw_data, _ in files:
        img = Image.open(io.BytesIO(raw_data))
        # correct orientation based on EXIF
        img = ImageOps.exif_transpose(img) 
        if img.mode != "RGB":
            img = img.convert("RGB")
            
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=92, optimize=True)
        buf.seek(0)
        img_buffers.append(buf)
        
    return img2pdf.convert([b.getvalue() for b in img_buffers])


def page_count(data: bytes) -> int:
    """Get the total number of pages in a PDF document.

    Args:
        data: The PDF file content.

    Returns:
        int: The number of pages.
    """
    with _open_pdf(data) as doc:
        return doc.page_count


def render_page_thumb(data: bytes, page_0based: int = 0, dpi: int = 120) -> bytes:
    """Render a preview thumbnail of a specific page.

    Args:
        data: The PDF file content.
        page_0based: The 0-based index of the page to render.
        dpi: The desired DPI for the rendered image.

    Returns:
        bytes: The PNG bytes of the page preview.

    Raises:
        ValueError: If an invalid page index is provided.
    """
    with _open_pdf(data) as doc:
        if page_0based < 0 or page_0based >= doc.page_count:
            raise ValueError(f"Invalid page index {page_0based}. Document has {doc.page_count} pages.")
            
        page = doc.load_page(page_0based)
        matrix = fitz.Matrix(dpi / 72, dpi / 72)
        pixmap = page.get_pixmap(matrix=matrix, alpha=False)
        return pixmap.tobytes("png")


def remove_password_pdf(data: bytes, password: str = "") -> bytes:
    """Remove encryption from a PDF document.

    Args:
        data: The PDF file content.
        password: The password to decrypt the document.

    Returns:
        bytes: The decrypted PDF file content.

    Raises:
        ValueError: If the password is incorrect or document cannot be decrypted.
    """
    doc = _open_pdf(data)
    try:
        if doc.needs_pass:
            if not doc.authenticate(password):
                raise ValueError("Incorrect password. Please provide the correct password to unlock this document.")
        return doc.tobytes(encryption=fitz.PDF_ENCRYPT_NONE, garbage=4, deflate=True)
    finally:
        doc.close()
