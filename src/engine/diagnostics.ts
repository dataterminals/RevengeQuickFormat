import { React, ReactNative } from "@vendetta/metro/common";
import { findByName, findByProps, findByStoreName } from "@vendetta/metro";
import { before } from "@vendetta/patcher";
import { showToast } from "@vendetta/ui/toasts";

import { hideStats } from "./apply";

// One-time, read-only capture of a real message-row object from RowManager. To
// hide a message cleanly we need to drop it where the row is *generated* (so no
// skeleton/placeholder is left behind), and for that we need the row's shape on
// this Discord build. The probe hooks generate, records the first row's keys,
// and then just early-returns on every later call. It never modifies the row.
const capturedRows: Record<string, string> = {};
let rowProbeNote: string | null = null;
let rowProbeUnpatch: (() => void) | null = null;

export function installRowProbe(): void {
	if (rowProbeUnpatch) return;
	try {
		const RowManager: any = findByName("RowManager");
		const proto = RowManager?.prototype;
		if (typeof proto?.generate !== "function") {
			rowProbeNote = "RowManager.generate not found";
			return;
		}
		// Capture one sample per rowType (message rows, and — if the member list
		// runs through RowManager — member rows), so we can confirm where each
		// surface's user id lives before patching it.
		rowProbeUnpatch = before("generate", proto, (args: any[]) => {
			try {
				const row = args?.[0];
				if (!row) return;
				const rt = String(row.rowType);
				if (capturedRows[rt] || Object.keys(capturedRows).length >= 6) return;
				const msg = row.message;
				capturedRows[rt] = [
					`keys=[${Object.keys(row).slice(0, 20).join(",")}]`,
					`user.id=${row.user?.id ?? "-"} userId=${row.userId ?? "-"} member.userId=${row.member?.userId ?? "-"} message.author.id=${msg?.author?.id ?? "-"}`,
				].join(" | ");
			} catch {
				/* ignore */
			}
		});
	} catch (e) {
		rowProbeNote = `row probe err ${(e as Error).message}`;
	}
}

export function removeRowProbe(): void {
	try {
		rowProbeUnpatch?.();
	} catch {
		/* ignore */
	}
	rowProbeUnpatch = null;
}

// Report the shape of the runtime objects QuickFormat needs to patch, so we can
// figure out the correct binding without a full debug console. This is the
// mobile stand-in for poking around in DevTools.
function probe(label: string, obj: any): string {
	if (obj == null) return `${label}: <${obj}>`;
	const name = obj.displayName || obj.name || "?";
	const sym = obj.$$typeof ? String(obj.$$typeof) : "-";
	return `${label}: type=${typeof obj} name=${name} $$typeof=${sym} render=${typeof obj.render} proto.render=${typeof obj?.prototype?.render}`;
}

export function runDiagnostics(): string {
	const RN: any = ReactNative;
	const lines: string[] = [];
	lines.push(`React=${(React as any)?.version ?? "?"} RN=${typeof RN}`);
	lines.push(probe("RN.Text", RN?.Text));
	lines.push(probe("RN.TextInput", RN?.TextInput));
	lines.push(probe("RN.View", RN?.View));

	// Element-creation entry points the injection engine patches.
	try {
		const rt: any = findByProps("jsx", "jsxs");
		const dev: any = findByProps("jsxDEV");
		lines.push(
			`createElement=${typeof (React as any)?.createElement} jsx=${typeof rt?.jsx} jsxs=${typeof rt?.jsxs} jsxDEV=${typeof dev?.jsxDEV}`,
		);
	} catch (e) {
		lines.push(`jsx runtime err ${(e as Error).message}`);
	}

	// Discord ships its own design-system Text; it may be the real target.
	try {
		const p: any = findByProps("Text", "View");
		lines.push(
			`findByProps(Text,View)=${
				p ? "found keys:" + Object.keys(p).slice(0, 8).join(",") : "null"
			}`,
		);
		if (p?.Text) lines.push(probe("  ↳ .Text", p.Text));
	} catch (e) {
		lines.push(`findByProps err ${(e as Error).message}`);
	}

	// Breadcrumbs for user-target surfaces. Prop-level matching (match.ts) is the
	// primary path; these help if we need to bind a specific module instead —
	// e.g. the message-row builder or the avatar-URL helper.
	try {
		const rm: any = findByName("RowManager", false);
		lines.push(`RowManager=${rm ? "found" : "null"}`);
		const av: any = findByProps("getUserAvatarURL");
		lines.push(
			`avatarUtils=${av ? "found keys:" + Object.keys(av).slice(0, 6).join(",") : "null"}`,
		);
	} catch (e) {
		lines.push(`user-surface probe err ${(e as Error).message}`);
	}

	// DM / private-channel list breadcrumbs — to hide a blocked user's DM row at
	// its data source (the way messages are hidden via RowManager), we need the
	// store that provides the sorted DM list and how it stores recipients.
	for (const name of [
		"getSortedPrivateChannels",
		"getPrivateChannelIds",
		"getSortedPrivateChannelIds",
		"getPrivateChannels",
		"getDMFromUserId",
	]) {
		try {
			const m: any = findByProps(name);
			lines.push(
				`${name}=${
					m
						? "fns:" +
						  Object.keys(m)
								.filter((k) => typeof m[k] === "function")
								.slice(0, 12)
								.join(",")
						: "null"
				}`,
			);
		} catch (e) {
			lines.push(`${name} err ${(e as Error).message}`);
		}
	}
	try {
		const store: any = findByProps("getSortedPrivateChannels");
		const list: any = store?.getSortedPrivateChannels?.();
		const c = Array.isArray(list) ? list[0] : undefined;
		lines.push(
			c
				? `privateChannel[0] keys=[${Object.keys(c).slice(0, 22).join(",")}] type=${c.type} recipients=${JSON.stringify(c.recipients ?? c.recipientIds ?? c.rawRecipients)?.slice(0, 80)}`
				: `privateChannels=${Array.isArray(list) ? "empty" : typeof list}`,
		);
	} catch (e) {
		lines.push(`privateChannel probe err ${(e as Error).message}`);
	}

	// Member-list store breadcrumb (the next surface to hide).
	try {
		const mls: any = findByStoreName("MemberListStore");
		lines.push(
			`MemberListStore=${
				mls
					? "fns:" +
					  Object.keys(mls)
							.filter((k) => typeof mls[k] === "function")
							.slice(0, 12)
							.join(",")
					: "null"
			}`,
		);
	} catch (e) {
		lines.push(`MemberListStore err ${(e as Error).message}`);
	}

	// DM-hide runtime stats — did the filters run, and did they match?
	lines.push(
		`dmHide: channelStore=${hideStats.channelStoreOk} patched(sorted=${hideStats.dmSortedPatched},ids=${hideStats.dmIdsPatched}) sorted=${hideStats.dmSortedIn}->${hideStats.dmSortedOut} ids=${hideStats.dmIdsIn}->${hideStats.dmIdsOut} idsResolved=${hideStats.dmIdsResolved} rowsHidden=${hideStats.dmRowHidden} dataFiltered=${hideStats.dmDataFiltered}`,
	);
	lines.push(
		`dmRowEl: ${hideStats.channelEl ?? "not captured — DM rows may render from an id, not a channel object"}`,
	);

	const rowTypes = Object.keys(capturedRows);
	if (rowProbeNote) {
		lines.push(`rows: ${rowProbeNote}`);
	} else if (!rowTypes.length) {
		lines.push("rows: none captured yet — scroll a channel and open a member list, then copy again");
	} else {
		lines.push("rows (by rowType):");
		for (const rt of rowTypes) lines.push(`  [${rt}] ${capturedRows[rt]}`);
	}

	return lines.join("\n");
}

// Copy the diagnostics to the clipboard (via the metro Clipboard module) so it
// can be pasted back for debugging.
export function copyDiagnostics(): void {
	const report = runDiagnostics();
	console.log("[QuickFormat] diagnostics:\n" + report);
	try {
		const Clipboard: any = findByProps("setString", "getString");
		Clipboard.setString(report);
		showToast("QuickFormat: diagnostics copied");
	} catch {
		showToast("QuickFormat: copy failed (logged to console)");
	}
}
