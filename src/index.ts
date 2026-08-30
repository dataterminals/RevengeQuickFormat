import Settings from "./components/Settings";
import { clear, reapply } from "./controller";
import { initStorage } from "./storage";

// Plugin entry point. Revenge/Vendetta calls onLoad when the plugin is enabled
// and onUnload when it is disabled or removed, and renders `settings` inside the
// plugin's page.

export function onLoad(): void {
	initStorage();
	reapply();
}

export function onUnload(): void {
	clear();
}

export const settings = Settings;
