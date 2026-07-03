// SSR stand-in for add-to-calendar-button-react (aliased in
// vite.config.ts for the prerender build only). The real package
// registers a web component against `customElements` at import time,
// which does not exist in Node; the button is interactive chrome with no
// SEO value, so prerendered documents render nothing and the take-over
// render mounts the real component.
export function AddToCalendarButton(): null {
  return null;
}
