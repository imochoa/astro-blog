# Serving the blog with Nginx behind Traefik

Traefik should own the public listener, HTTPS redirect, certificates, and global
TLS policy. Nginx only needs an internal HTTP listener that serves the generated
`dist/` directory. Do not publish the Nginx port directly.

## Request path

The deployment should follow this path:

```text
browser -> Traefik :443 -> Nginx :8080 -> dist/
```

Attach Nginx to Traefik's container network and configure Traefik to use port
`8080`. Keep certificate paths and `listen 443 ssl` directives out of Nginx.

For a Quadlet deployment, the relevant settings are equivalent to:

```ini
[Container]
Network=reverse-proxy-net
Label=traefik.enable=true
Label=traefik.http.routers.astro-blog.rule=Host(`blog.imochoa.com`)
Label=traefik.http.routers.astro-blog.entrypoints=https-external
Label=traefik.http.routers.astro-blog.tls=true
Label=traefik.http.services.astro-blog.loadbalancer.server.port=8080
```

Match the router and service naming conventions used by the existing Traefik
configuration. No host port mapping is required.

## Nginx server block

Replace `/usr/share/nginx/html` if the built site is mounted elsewhere.

```nginx
server {
    listen 8080;
    listen [::]:8080;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    server_tokens off;
    charset utf-8;
    etag on;

    # Keep the app-specific policy here. Put HSTS and other global TLS headers
    # in Traefik so they are applied consistently across public services.
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), geolocation=(), microphone=()" always;
    add_header Content-Security-Policy "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; frame-src 'self' https://hopp.sh https://marimo.app; img-src 'self' data: https://hopp.sh; manifest-src 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:; upgrade-insecure-requests" always;

    # Enable compression here only when the Traefik router does not already use
    # its compression middleware. Responses should be compressed at one layer.
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_comp_level 6;
    gzip_types
        application/javascript
        application/json
        application/manifest+json
        application/rss+xml
        application/wasm
        application/xml
        image/svg+xml
        text/css
        text/plain;

    # Astro fingerprints these files, so a long cache lifetime is safe.
    location ^~ /_astro/ {
        try_files $uri =404;
        expires 1y;
        access_log off;
    }

    # Some Pagefind entry filenames remain stable between builds. Revalidate
    # them so a deployment cannot leave a browser using an old index loader.
    location ^~ /pagefind/ {
        try_files $uri =404;
        expires -1;
    }

    location = /site.webmanifest {
        try_files $uri =404;
        default_type application/manifest+json;
        expires 1d;
    }

    location ~* \.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$ {
        try_files $uri =404;
        expires 7d;
        access_log off;
    }

    # Astro emits directory-style routes such as /blog/post/.
    location / {
        try_files $uri $uri/ $uri/index.html =404;
        expires -1;
    }

    error_page 404 /404.html;
    location = /404.html {
        internal;
        expires -1;
    }
}
```

The policy allows `https://hopp.sh` in `frame-src` for the request widget and
`https://marimo.app` for the hosted marimo notebook. It also permits same-origin
frames so self-hosted marimo WebAssembly exports can be used later. The inline
script and style allowances are currently required by the early theme
initializer, structured data, syntax highlighting, and component styles. If
those are moved to external assets later, tighten the policy rather than adding
more sources.

## WebAssembly MIME type

The interactive Wasm example needs `.wasm` responses to use
`application/wasm`. Current Nginx images normally include this mapping in
`/etc/nginx/mime.types`:

```nginx
types {
    application/wasm wasm;
}
```

Check the effective configuration inside the container:

```sh
nginx -T 2>/dev/null | grep -F "application/wasm"
```

If the mapping is absent, add it to the `types` block loaded by the main
`nginx.conf`. Do not replace the complete MIME map with a block containing only
Wasm.

## Forwarded client addresses

Static serving does not require Nginx to interpret `X-Forwarded-Proto` or
`X-Forwarded-Host`. Traefik already sets them. If Nginx access logs need the real
client address, trust only the container subnet used by Traefik:

```nginx
set_real_ip_from 10.0.0.0/24; # replace with the actual network subnet
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

Do not use `set_real_ip_from 0.0.0.0/0`; that lets a direct client forge its
address if the Nginx port is ever exposed.

## Deployment checks

Build before replacing the served directory:

```sh
pnpm run build
pnpm run check:links
```

After changing Nginx configuration, test and reload it inside the container:

```sh
nginx -t
nginx -s reload
```

Verify the public responses through Traefik:

```sh
curl -I https://blog.imochoa.com/
curl -I https://blog.imochoa.com/_astro/EXAMPLE.css
curl -I https://blog.imochoa.com/site.webmanifest
curl -I https://blog.imochoa.com/does-not-exist
```

The first response should be HTTPS, fingerprinted assets should have a long
cache lifetime, the manifest should have an appropriate content type, and the
missing path should return the custom page with status `404`.
