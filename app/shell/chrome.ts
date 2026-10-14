import { isTauri } from "../ipc";

// macos windows use an overlay title bar, so the header draws the title row under the traffic lights
export const macOverlay = isTauri() && navigator.userAgent.includes("Mac");

// matches the native title bar, which centres the traffic lights in it
export const TITLE_ROW_HEIGHT = 28;
