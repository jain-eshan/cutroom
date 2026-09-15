"""Unexpected server errors have to reach the app as a readable message.

They didn't. CORSMiddleware wraps normal responses, but an unhandled exception
became a bare 500 from Starlette's outermost error middleware with no
access-control-allow-origin header. The browser discarded it, and the app said
"Could not reach the local processing service" while the service was up and
had a real error to report -- which is how a lip-sync crash on a real iPhone
recording surfaced as a connection problem."""

import pytest
from fastapi.testclient import TestClient

import main

ORIGIN = "http://localhost:3460"
FACES = b'{"frameWidth": 1, "frameHeight": 1, "people": []}'


@pytest.fixture(scope="module")
def client():
	# Report 500s as responses, the way a browser sees them, rather than
	# re-raising inside the test.
	return TestClient(main.app, raise_server_exceptions=False)


def _export(client, regions: str):
	return client.post(
		"/export",
		headers={"Origin": ORIGIN},
		files={
			"file": ("clip.bin", b"x"),
			"faces": ("faces.json", FACES, "application/json"),
		},
		data={"regions": regions},
	)


def test_an_unexpected_error_is_readable_by_the_app(client):
	response = _export(client, "[{}]")  # a region missing its keys -> KeyError
	assert response.status_code == 500
	assert response.headers.get("access-control-allow-origin") == ORIGIN
	assert "KeyError" in response.json()["detail"]


def test_expected_errors_are_unchanged(client):
	response = _export(client, "not json")
	assert response.status_code == 400
	assert response.headers.get("access-control-allow-origin") == ORIGIN
	assert "Malformed JSON" in response.json()["detail"]
