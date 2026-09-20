import subprocess
from pathlib import Path

from .ffmpeg import FFMPEG, FFPROBE

# ffprobe reading a file's stream list, or ffmpeg re-encoding a wav out of it,
# both normally finish in well under a second even on a multi-GB recording --
# they're reading a header and a bit of the stream, not the whole file. A
# malformed container (a truncated MOV, a phone recording with a broken moov
# atom) is a known way for either to hang instead of erroring, which would
# otherwise tie up the thread this runs in (see main.py's asyncio.to_thread)
# forever, with no progress update and no way for the job to ever report
# failure -- worse than any error message.
FFPROBE_TIMEOUT_S = 30
FFMPEG_EXTRACT_TIMEOUT_S = 300


class NoAudioTrack(Exception):
	"""The upload has no audio. Everything downstream -- transcript, speakers,
	who is talking -- is derived from sound, so there is no partial result
	worth returning."""


class UnreadableRecording(Exception):
	"""ffprobe couldn't read the file at all -- distinct from NoAudioTrack,
	which means ffprobe read it fine and genuinely found no audio stream.

	Collapsing the two used to mean a corrupted upload, a permissions error,
	or FFPROBE_BINARY pointing at nothing all got the same "has no audio
	track" message, which sends whoever reads it looking at their microphone
	instead of at the actual problem -- the "fallback that produces a
	quietly wrong result" this project otherwise goes out of its way to
	avoid (see faces.py, diarize.py)."""


def has_audio(input_path: Path) -> bool:
	try:
		out = subprocess.run(
			[
				FFPROBE, "-v", "error", "-select_streams", "a",
				"-show_entries", "stream=codec_type", "-of", "csv=p=0",
				str(input_path),
			],
			check=True, capture_output=True, text=True, timeout=FFPROBE_TIMEOUT_S,
		)
	# OSError, not FileNotFoundError: a binary that is missing and one that
	# exists but cannot be executed -- wrong CPU architecture (errno 86), no
	# exec bit (errno 13) -- are the same problem to whoever is looking at the
	# screen, and only the first is a FileNotFoundError. The narrower catch
	# let a wrong-arch ffprobe escape as a raw traceback instead of this.
	except OSError as err:
		raise UnreadableRecording(
			f"Could not run ffprobe to inspect {input_path.name} ({err}). "
			"Check FFPROBE_BINARY if it's set in server/.env."
		) from err
	except subprocess.TimeoutExpired as err:
		raise UnreadableRecording(
			f"ffprobe did not finish reading {input_path.name} within {FFPROBE_TIMEOUT_S}s. "
			"The file may be corrupted or use an unusual container."
		) from err
	except subprocess.CalledProcessError as err:
		stderr = (err.stderr or "").strip()
		raise UnreadableRecording(
			f"ffprobe could not read {input_path.name} -- it may be corrupted or in an unsupported format."
			+ (f" ffprobe said: {stderr[-500:]}" if stderr else "")
		) from err
	return "audio" in (out.stdout or "")


def extract_wav(input_path: Path, output_path: Path, sample_rate: int = 16000) -> None:
	"""Extract a mono, 16kHz PCM wav from any video/audio file via ffmpeg."""
	if not has_audio(input_path):
		raise NoAudioTrack(
			f"{input_path.name} has no audio track. This edits a recording using what "
			"was said in it, so a silent video has nothing to work from."
		)
	try:
		subprocess.run(
			[
				FFMPEG,
				"-y",
				"-i", str(input_path),
				"-ac", "1",
				"-ar", str(sample_rate),
				"-vn",
				str(output_path),
			],
			check=True,
			capture_output=True,
			timeout=FFMPEG_EXTRACT_TIMEOUT_S,
		)
	except subprocess.TimeoutExpired as err:
		raise UnreadableRecording(
			f"ffmpeg did not finish extracting audio from {input_path.name} within "
			f"{FFMPEG_EXTRACT_TIMEOUT_S}s. The file may be corrupted."
		) from err
