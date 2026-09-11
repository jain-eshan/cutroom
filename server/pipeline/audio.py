import subprocess
from pathlib import Path


def extract_wav(input_path: Path, output_path: Path, sample_rate: int = 16000) -> None:
	"""Extract a mono, 16kHz PCM wav from any video/audio file via ffmpeg."""
	subprocess.run(
		[
			"ffmpeg",
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
