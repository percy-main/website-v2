import { createContext } from "react";

/**
 * Whether the author has ticked the photo consent box. Provided by the
 * editor page around the BlockNote canvas; block components can't take
 * props from the page, so consent reaches blocks with their own upload
 * affordance (the photo gallery's add-photos tile) via context - the
 * same way blocks reach react-query. Lives outside the component files
 * so Fast Refresh can preserve their state.
 */
export const UploadConsentContext = createContext(false);
