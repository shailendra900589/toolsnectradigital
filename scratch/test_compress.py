import fitz
from PIL import Image
import io

def compress_pdf(data: bytes) -> bytes:
    doc = fitz.open(stream=data, filetype='pdf')
    for page in doc:
        for img in page.get_images():
            xref = img[0]
            try:
                base_img = doc.extract_image(xref)
                if not base_img: continue
                img_data = base_img['image']
                ext = base_img['ext']
                
                # Compress with PIL
                pil_img = Image.open(io.BytesIO(img_data))
                if pil_img.mode in ('RGBA', 'P'):
                    pil_img = pil_img.convert('RGB')
                
                out = io.BytesIO()
                # Use a lower quality to shrink
                pil_img.save(out, format='JPEG', quality=45, optimize=True)
                new_img_data = out.getvalue()
                
                if len(new_img_data) < len(img_data):
                    page.replace_image(xref, stream=new_img_data)
            except Exception as e:
                pass
    return doc.tobytes(deflate=True, garbage=4, clean=True)

test_data = b'%PDF-1.4\n1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj\n2 0 obj <</Type /Pages /Kids [] /Count 0>> endobj\nxref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000056 00000 n \ntrailer\n<</Size 3 /Root 1 0 R>>\nstartxref\n106\n%%EOF'
print(len(compress_pdf(test_data)))
