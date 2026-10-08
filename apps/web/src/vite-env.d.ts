/// <reference types="vite/client" />

/** The variables of the build (task 0.10). All optional: a laptop and CI set none. */
interface ImportMetaEnv {
  /** Where the error reports of the web app go; unset: none are sent. */
  readonly VITE_SENTRY_DSN?: string;
  /** `test` or `production`; unset: `development`. */
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** The commit of the build, from `RENDER_GIT_COMMIT` (vite.config.ts). */
  readonly VITE_RELEASE?: string;
}
