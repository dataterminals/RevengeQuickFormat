import { React, ReactNative as RN } from "@vendetta/metro/common";
import { useProxy } from "@vendetta/storage";
import { Forms } from "@vendetta/ui/components";

import { reapply } from "../controller";
import { parseSheet } from "../engine/parser";
import { targets } from "../engine/targets";
import { vstorage } from "../storage";

const { FormSection, FormRow, FormSwitchRow, FormDivider } = Forms;
const { ScrollView, Text, TextInput } = RN;

// Explicit high-contrast colours rather than themed semantic colours: on some
// Revenge builds the semantic colours don't resolve here and text falls back to
// black, which is unreadable on a dark background. A dark editor box with light
// text stays readable under both light and dark app themes.
const COLORS = {
	editorBg: "#1e1f22",
	editorText: "#f2f3f5",
	editorBorder: "#3f4147",
	placeholder: "#87898c",
	error: "#f23f43",
	hint: "#949ba4",
};

const styles = RN.StyleSheet.create({
	editor: {
		minHeight: 220,
		marginHorizontal: 12,
		marginVertical: 8,
		padding: 12,
		borderRadius: 8,
		borderWidth: 1,
		borderColor: COLORS.editorBorder,
		color: COLORS.editorText,
		backgroundColor: COLORS.editorBg,
		fontFamily: "monospace",
		fontSize: 14,
		lineHeight: 20,
		textAlignVertical: "top",
	},
	error: {
		color: COLORS.error,
		marginHorizontal: 16,
		marginVertical: 2,
		fontSize: 13,
	},
	hint: {
		color: COLORS.hint,
		marginHorizontal: 16,
		marginVertical: 2,
		fontSize: 13,
	},
});

export default function Settings() {
	useProxy(vstorage);

	// Edit against a local draft so we only re-patch the app when the user
	// explicitly saves, rather than on every keystroke.
	const [draft, setDraft] = React.useState(vstorage.source);
	const { errors } = parseSheet(draft);
	const dirty = draft !== vstorage.source;

	const save = () => {
		vstorage.source = draft;
		reapply(true);
	};

	return (
		<ScrollView>
			<FormSwitchRow
				label="Enabled"
				subLabel="Apply your QuickFormat sheet"
				value={vstorage.enabled}
				onValueChange={(v: boolean) => {
					vstorage.enabled = v;
					reapply(true);
				}}
			/>
			<FormDivider />

			<FormSection title="Sheet">
				<TextInput
					style={styles.editor}
					value={draft}
					onChangeText={setDraft}
					multiline
					autoCapitalize="none"
					autoCorrect={false}
					placeholder="{ }"
					placeholderTextColor={COLORS.placeholder}
				/>
				{errors.length === 0 ? (
					<Text style={styles.hint}>No problems found.</Text>
				) : (
					errors.map((e, i) => (
						<Text key={i} style={styles.error}>
							• {e}
						</Text>
					))
				)}
			</FormSection>

			<FormRow
				label={dirty ? "Save & apply" : "Saved"}
				onPress={save}
				disabled={!dirty}
			/>
			<FormDivider />

			<FormSection title="Available targets">
				{targets.map((t) => (
					<FormRow
						key={t.key}
						label={t.label}
						subLabel={`"${t.key}" — ${t.description}${
							t.status === "experimental" ? " (experimental)" : ""
						}`}
					/>
				))}
			</FormSection>
		</ScrollView>
	);
}
