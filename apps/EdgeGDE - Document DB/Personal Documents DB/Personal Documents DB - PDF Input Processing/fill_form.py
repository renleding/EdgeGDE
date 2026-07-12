"""
Add AcroForm fields to the PDF at measured positions, then fill them.
This ensures text is positioned exactly by the PDF form engine.
"""

import pypdf
from pypdf.generic import DictionaryObject, NameObject, NumberObject, TextStringObject, ArrayObject, RectangleObject

PDF = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/Personal Documents DB/Personal Documents DB - PDF Input Processing/Broker Accreditation Form - Outsource Financial.pdf"
OUT = "/Users/warren/Documents/_HQ_AI/EdgeGDE/apps/EdgeGDE - Document DB/Personal Documents DB/Personal Documents DB - PDF Output Processed/Broker Accreditation Form - FILLED.pdf"

vals = {
    "Title": "Mr",
    "GivenNames": "Warren Robert",
    "Surname": "LEDINGHAM",
    "DOB": "15/10/1969",
    "Address": "UNIT 1, 32 VICTORIA ST, EAST BRANXTON NSW 2335",
    "State": "NSW",
    "Postcode": "2335",
    "LicenceNo": "1170CT",
}

reader = pypdf.PdfReader(PDF)
writer = pypdf.PdfWriter()
for p in reader.pages:
    writer.add_page(p)

W = float(reader.pages[0].mediabox.width)
H = float(reader.pages[0].mediabox.height)

# Field definitions: (name, x_left, y_bottom, width, height)
# y_bottom = H - pdfplumber_top - offset (negative offset = lower on page)
# Offset of 5pt moves text lower in the field box, 18pt height for room
fields = [
    ("Title",      128, H - 352 - 5, 40, 18),
    ("GivenNames", 175, H - 352 - 5, 160, 18),
    ("Surname",    385, H - 352 - 5, 180, 18),
    ("DOB",         60, H - 394 - 5, 120, 18),
    ("Address",    245, H - 394 - 5, 310, 18),
    ("State",      472, H - 394 - 5, 40, 18),
    ("Postcode",   522, H - 394 - 5, 60, 18),
    ("LicenceNo",  175, H - 418 - 5, 150, 18),
]

# Add each field as a widget annotation on page 0
for fname, fx, fy, fw, fh in fields:
    widget = pypdf.generic.DictionaryObject()
    widget[NameObject("/Type")] = NameObject("/Annot")
    widget[NameObject("/Subtype")] = NameObject("/Widget")
    widget[NameObject("/FT")] = NameObject("/Tx")
    widget[NameObject("/T")] = TextStringObject(fname)
    widget[NameObject("/Rect")] = RectangleObject((fx, fy, fx + fw, fy + fh))
    widget[NameObject("/F")] = NumberObject(4)  # Print flag
    widget[NameObject("/Ff")] = NumberObject(0)  # No flags
    widget[NameObject("/V")] = TextStringObject(vals[fname])
    widget[NameObject("/DA")] = TextStringObject(f"/Helv 10 Tf 0 g")
    
    # Add as indirect then annotate
    writer.add_annotation(page_number=0, annotation=widget)

# Also add AcroForm to catalog
# First collect all field references from page annotations
page0 = writer.pages[0]
annots = page0.get('/Annots', [])
field_refs = ArrayObject()
for a in annots:
    field_refs.append(a)

root = writer._root_object
root[NameObject("/AcroForm")] = DictionaryObject({
    NameObject("/Fields"): field_refs,
    NameObject("/NeedAppearances"): NameObject("/True"),
    NameObject("/DA"): TextStringObject("/Helv 10 Tf 0 g"),
})

# Add font resource to page 0
page0_resources = page0.get('/Resources', pypdf.generic.DictionaryObject())
fonts = page0_resources.get('/Font', pypdf.generic.DictionaryObject())
fonts[NameObject("/Helv")] = writer._add_object(DictionaryObject({
    NameObject("/Type"): NameObject("/Font"),
    NameObject("/Subtype"): NameObject("/Type1"),
    NameObject("/BaseFont"): NameObject("/Helvetica"),
    NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
}))
page0_resources[NameObject("/Font")] = fonts
page0[NameObject("/Resources")] = page0_resources

with open(OUT, "wb") as f:
    writer.write(f)

import os
print(f"Saved: {OUT} ({os.path.getsize(OUT)} bytes)")

# Verify
r2 = pypdf.PdfReader(OUT)
print(f"AcroForm: {bool(r2.trailer['/Root'].get('/AcroForm'))}")
try:
    ff = r2.get_form_text_fields()
    print(f"Fields: {ff}")
except Exception as e:
    print(f"Field read error: {e}")
    # Fallback: check annotations
    a0 = r2.pages[0].get('/Annots', [])
    print(f"Annotations on page 0: {len(a0)}")
    for a in a0:
        obj = a.get_object()
        print(f"  {obj.get('/T')}: {obj.get('/V')}")
