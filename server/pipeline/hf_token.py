"""Setting the Hugging Face token from the app instead of a text editor.

Speaker diarisation needs a token whose account has accepted the model
licence. Asking a first-time user to create `server/.env` by hand and restart
the service was the one setup step that required a terminal and a file they'd
never seen, so the setup screen takes the token directly: it's checked with
Hugging Face and only saved once it can actually load the model.
"""

import os
import re
from pathlib import Path

from . import diarize
from .diarize import DIARIZATION_MODEL, DIARIZATION_SETUP_URL

# Also what stops a pasted value from smuggling a newline -- and so a second
# setting -- into the .env file.
TOKEN_PATTERN = re.compile(r"hf_[A-Za-z0-9]{20,}")

INVALID_TOKEN_MESSAGE = (
	"Hugging Face didn't accept that token. Check it was copied in full, or create a new one."
)


def token_format_problem(token: str) -> str | None:
	if not token:
		return "Paste a token first."
	if not TOKEN_PATTERN.fullmatch(token):
		return "That doesn't look like a Hugging Face token — they start with hf_ and have no spaces."
	return None


def _status(err: Exception) -> int | None:
	return getattr(getattr(err, "response", None), "status_code", None)


def describe_token_error(err: Exception) -> str:
	"""Why Hugging Face wouldn't say whose token this is."""
	from huggingface_hub.errors import HfHubHTTPError

	if isinstance(err, HfHubHTTPError):
		if _status(err) in (401, 403):
			return INVALID_TOKEN_MESSAGE
		return f"Hugging Face answered with an error ({_status(err)}). Try again in a moment."
	return f"Couldn't reach Hugging Face to check the token: {err}"


def describe_access_error(err: Exception, account: str) -> str:
	"""Why a token Hugging Face *does* recognise still can't load the model."""
	from huggingface_hub.errors import GatedRepoError, HfHubHTTPError, RepositoryNotFoundError

	# Subclasses before HfHubHTTPError, which both of these are.
	if isinstance(err, GatedRepoError):
		return (
			f"That token belongs to {account}, but that account hasn't accepted the model's terms "
			f"yet. Accept them at {DIARIZATION_SETUP_URL}, then press Save again."
		)
	if isinstance(err, RepositoryNotFoundError):
		return "That token can't see the model. Create one with Read access and paste that instead."
	if isinstance(err, HfHubHTTPError):
		return f"Hugging Face answered with an error ({_status(err)}). Try again in a moment."
	return f"Couldn't reach Hugging Face to check the token: {err}"


def check_access(token: str) -> str | None:
	"""None if this token can load the diarisation model, otherwise why not.

	Two calls, in this order, on purpose. Hugging Face answers a made-up token
	on a gated model exactly as it answers a real account that hasn't accepted
	the licence, so checking the model alone told people with a mistyped token
	to go accept terms they had already accepted. Asking whose token it is
	first separates "not a token" from "not agreed yet".
	"""
	from huggingface_hub import HfApi

	api = HfApi()
	try:
		account = api.whoami(token=token).get("name") or "that account"
	except Exception as err:
		return describe_token_error(err)
	try:
		api.auth_check(DIARIZATION_MODEL, token=token)
	except Exception as err:
		return describe_access_error(err, account)
	return None


def set_env_line(text: str, key: str, value: str) -> str:
	"""`text` with `key` set to `value`: replaced if present, appended if not,
	every other line left exactly as it was."""
	kept = [line for line in text.splitlines() if not line.startswith(f"{key}=")]
	return "\n".join([*kept, f"{key}={value}"]) + "\n"


def save_token(token: str, env_path: Path) -> None:
	"""Persist the token and apply it to this process, so no restart is needed."""
	existing = env_path.read_text() if env_path.exists() else ""
	env_path.write_text(set_env_line(existing, "HF_TOKEN", token))
	env_path.chmod(0o600)
	os.environ["HF_TOKEN"] = token
	# A model already loaded with a previous token would otherwise keep being used.
	diarize.forget_pipeline()
