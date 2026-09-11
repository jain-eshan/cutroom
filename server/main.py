import base64
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from pipeline.audio import extract_wav
from pipeline.diarize import diarize
from pipeline.faces import detect_and_track_faces, get_video_dimensions
from pipeline.transcribe import transcribe
from pipeline.turns import build_turns

app = FastAPI(title="podcast-editor processing service")

app.add_middleware(
	CORSMiddleware,
	allow_origins=["http://localhost:3460", "http://127.0.0.1:3460"],
	allow_methods=["*"],
	allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
	return {"status": "ok"}


@app.post("/transcribe")
async def transcribe_endpoint(file: UploadFile, num_speakers: int | None = None) -> dict:
	with tempfile.TemporaryDirectory() as tmp:
		input_path = Path(tmp) / (file.filename or "input")
		input_path.write_bytes(await file.read())
		wav_path = Path(tmp) / "audio.wav"
		extract_wav(input_path, wav_path)

		segments = transcribe(str(wav_path))
		speaker_segments = diarize(str(wav_path), num_speakers=num_speakers)
		turns = build_turns(segments, speaker_segments)

	return {
		"turns": [
			{"speaker": t.speaker, "start": t.start, "end": t.end, "text": t.text} for t in turns
		]
	}


@app.post("/detect-faces")
async def detect_faces_endpoint(file: UploadFile) -> dict:
	with tempfile.TemporaryDirectory() as tmp:
		input_path = Path(tmp) / (file.filename or "input")
		input_path.write_bytes(await file.read())

		width, height = get_video_dimensions(str(input_path))
		tracks = detect_and_track_faces(str(input_path))

	return {
		"frameWidth": width,
		"frameHeight": height,
		"tracks": [
			{
				"id": tr.id,
				"thumbnail": "data:image/jpeg;base64," + base64.b64encode(tr.thumbnail_jpeg).decode(),
				"keyframes": [
					{
						"t": kf.t,
						"bbox": {
							"x": kf.bbox.x,
							"y": kf.bbox.y,
							"width": kf.bbox.width,
							"height": kf.bbox.height,
						},
					}
					for kf in tr.keyframes
				],
			}
			for tr in tracks
		],
	}
