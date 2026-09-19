import { Button, EdgeCaseCard, Screen } from "@/components/ui";

/** Face detection found nobody. Shown instead of the cast step, which would
 * otherwise ask "who is this?" with no faces to choose from. */
export function NoFacesScreen({
	onKeepGoing,
	onPickAnother,
}: {
	onKeepGoing: () => void;
	onPickAnother: () => void;
}) {
	return (
		<Screen width={440}>
			<EdgeCaseCard
				label="Nobody on camera"
				title="We couldn't find any faces"
				why="Maybe it's an audio-only recording, or the camera never saw anyone clearly. Either way there's nothing to cut between — so we'll leave the picture alone."
				actions={
					<>
						<Button variant="primary" onClick={onKeepGoing}>
							Keep going anyway
						</Button>
						<Button onClick={onPickAnother}>Pick a different file</Button>
					</>
				}
			/>
		</Screen>
	);
}
