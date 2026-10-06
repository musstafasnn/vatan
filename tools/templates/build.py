#!/usr/bin/env python3
# Masaüstünde ve Dosyalar'da "Yeni Belge" menüsü, kullanıcının Şablonlar
# klasöründeki dosyalardan oluşur. Buradaki boş belgeler o klasöre kopyalanır.
#
# ODF bir zip'tir; "mimetype" sıkıştırmasız ve ilk girdi olmalı, yoksa
# LibreOffice dosyayı tanımaz. Zaman damgası sabit: yeniden üretim bayt bayt aynı.
#
#   python3 tools/templates/build.py
import pathlib
import zipfile

OUT = pathlib.Path(__file__).resolve().parents[2] / 'data' / 'templates'
STAMP = (2026, 1, 1, 0, 0, 0)

NS = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
      'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
      'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
      'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
      'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
      'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" '
      'office:version="1.3"')

DOCUMENTS = {
    'Writer Belgesi.odt': ('application/vnd.oasis.opendocument.text',
                           '<office:text><text:p/></office:text>', ''),
    'Calc Tablosu.ods': ('application/vnd.oasis.opendocument.spreadsheet',
                         '<office:spreadsheet><table:table table:name="Sayfa1">'
                         '<table:table-row><table:table-cell/></table:table-row>'
                         '</table:table></office:spreadsheet>', ''),
    # Sunu sayfası bir ana sayfaya bağlanmazsa Impress boş pencere açar.
    'Impress Sunusu.odp': ('application/vnd.oasis.opendocument.presentation',
                           '<office:presentation><draw:page draw:name="Slayt1" '
                           'draw:master-page-name="Varsayilan"/></office:presentation>',
                           '<office:master-styles><style:master-page style:name="Varsayilan"/>'
                           '</office:master-styles>'),
}


def entry(name):
    info = zipfile.ZipInfo(name, STAMP)
    info.external_attr = 0o644 << 16
    return info


def write_odf(path, mime, body, master):
    manifest = ('<?xml version="1.0" encoding="UTF-8"?>\n'
                '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" '
                'manifest:version="1.3">'
                f'<manifest:file-entry manifest:full-path="/" manifest:media-type="{mime}"/>'
                '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
                '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
                '</manifest:manifest>')
    content = f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content {NS}><office:body>{body}</office:body></office:document-content>'
    styles = f'<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles {NS}>{master}</office:document-styles>'
    with zipfile.ZipFile(path, 'w') as odf:
        odf.writestr(entry('mimetype'), mime, compress_type=zipfile.ZIP_STORED)
        for name, data in (('META-INF/manifest.xml', manifest), ('content.xml', content), ('styles.xml', styles)):
            odf.writestr(entry(name), data, compress_type=zipfile.ZIP_DEFLATED)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'Metin Belgesi.txt').write_bytes(b'')
    for name, (mime, body, master) in DOCUMENTS.items():
        write_odf(OUT / name, mime, body, master)


if __name__ == '__main__':
    main()
