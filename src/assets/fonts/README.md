# Bundled social-image font

`Inter-Regular.ttf` and `Inter-Bold.ttf` come from the Inter 4.1 release:
<https://github.com/rsms/inter/releases/tag/v4.1>. They were decompressed from
the release's WOFF2 files with `fonttools ttLib.woff2 decompress`.

The asset generator passes these files directly to Sharp when rasterizing text
for the default Open Graph image. This avoids substituting a host font and
keeps the generated PNG identical in development and CI. Keep them as TrueType:
Sharp's Pango/FreeType text renderer silently ignores a WOFF2 `fontfile` and
falls back to a host font.

Inter is licensed under the SIL Open Font License 1.1; see `OFL.txt`.
