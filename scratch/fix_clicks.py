import os
import glob

d = r'c:\Users\uuu\OneDrive\Desktop\TOOLS PY\toolstudio\templates\toolstudio'
files = glob.glob(os.path.join(d, '*.html'))

for f in files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    if 'a.click();' in content and 'document.body.appendChild(a);' not in content:
        content = content.replace('a.click();', 'document.body.appendChild(a); a.click(); document.body.removeChild(a);')
        with open(f, 'w', encoding='utf-8') as file:
            file.write(content)
        print('Fixed ' + os.path.basename(f))
