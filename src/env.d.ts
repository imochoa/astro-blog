/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly SITE_BUILD_COMMIT: string;
  readonly SITE_BUILD_DATE: string;
  readonly SITE_BUILD_DIRTY: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
