import subprocess
from pathlib import Path

from .ffmpeg import FFMPEG, FFPROBE


class NoAudioTrack(Exception):
	"""The upload has no audio. Everything downstream -- transcript, speakers,
	who is talking -- is derived from sound, so there is no partial result
	worth returning."""


def has_audio(input_path: Path) -> bool:
	try:
		out = subprocess.run(
			[
				FFPROBE, "-v", "error", "-select_streams", "a",
				"-show_entries", "stream=codec_type", "-of", "csv=p=0",
				str(input_path),
			],
			check=True, capture_output=True, text=True,
		)
	except (subprocess.CalledProcessError, FileNotFoundError):
		return False
	return "audio" in (out.stdout or "")


def extract_wav(input_path: Path, output_path: Path, sample_rate: int = 16000) -> None:
	"""Extract a mono, 16kHz PCM wav from any video/audio file via ffmpeg."""
	if not has_audio(input_path):
		raise NoAudioTrack(
			f"{input_path.name} has no audio track. This edits a recording using what "
			"was said in it, so a silent video has nothing to work from."
		)
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
	)
