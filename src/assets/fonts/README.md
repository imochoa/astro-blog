# Bundled social-image font

`Inter-Regular.woff2` and `Inter-Bold.woff2` come from the Inter 4.1 release:
<https://github.com/rsms/inter/releases/tag/v4.1>.

The asset generator passes these files directly to Sharp when rasterizing text
for the default Open Graph image. This avoids substituting a host font and
keeps the generated PNG identical in development and CI.

Inter is licensed under the SIL Open Font License 1.1; see `OFL.txt`.
