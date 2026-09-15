"""Tests for pipeline/hf_token.py -- taking the Hugging Face token from the
setup screen. Hugging Face itself is stood in for; what's tested is the order
of the checks and the wording a first-time user reads."""

import os
from types import SimpleNamespace

import pytest
from huggingface_hub import HfApi
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError, RepositoryNotFoundError

from pipeline import diarize
from pipeline.hf_token import (
	INVALID_TOKEN_MESSAGE,
	check_access,
	save_token,
	set_env_line,
	token_format_problem,
)

VALID = "hf_" + "a" * 34


def _http_error(cls, status: int):
	# These normally wrap a real HTTP response; only the type and the status
	# code matter here, so skip the constructor.
	err = cls.__new__(cls)
	err.response = SimpleNamespace(status_code=status)
	return err


def _hugging_face(monkeypatch, *, whoami=None, auth_check=None):
	def fake_whoami(self, token=None):
		if isinstance(whoami, Exception):
			raise whoami
		return {"name": "maya"}

	def fake_auth_check(self, repo_id, *, token=None, **_):
		if isinstance(auth_check, Exception):
			raise auth_check

	monkeypatch.setattr(HfApi, "whoami", fake_whoami)
	monkeypatch.setattr(HfApi, "auth_check", fake_auth_check)


class TestTokenFormat:
	def test_a_real_looking_token_passes(self):
		assert token_format_problem(VALID) is None

	def test_empty_asks_for_a_token(self):
		assert token_format_problem("") == "Paste a token first."

	def test_wrong_prefix_is_rejected(self):
		assert token_format_problem("sk_" + "a" * 34) is not None

	def test_a_newline_cannot_sneak_a_second_setting_into_env(self):
		assert token_format_problem(VALID + "\nFFMPEG_BINARY=/tmp/evil") is not None


class TestCheckAccess:
	def test_a_made_up_token_is_called_invalid_not_unlicensed(self, monkeypatch):
		# The regression: Hugging Face reports a fake token on a gated model as
		# "gated", which used to send people to accept terms they'd accepted.
		_hugging_face(
			monkeypatch,
			whoami=_http_error(HfHubHTTPError, 401),
			auth_check=_http_error(GatedRepoError, 403),
		)
		message = check_access(VALID)
		assert message == INVALID_TOKEN_MESSAGE
		assert "terms" not in message

	def test_unaccepted_terms_name_the_account_and_link_them(self, monkeypatch):
		_hugging_face(monkeypatch, auth_check=_http_error(GatedRepoError, 403))
		message = check_access(VALID)
		assert "maya" in message
		assert diarize.DIARIZATION_SETUP_URL in message

	def test_a_token_that_cannot_see_the_model_asks_for_read_access(self, monkeypatch):
		_hugging_face(monkeypatch, auth_check=_http_error(RepositoryNotFoundError, 404))
		assert "Read access" in check_access(VALID)

	def test_a_hugging_face_outage_is_not_blamed_on_the_token(self, monkeypatch):
		_hugging_face(monkeypatch, whoami=_http_error(HfHubHTTPError, 503))
		assert check_access(VALID) != INVALID_TOKEN_MESSAGE

	def test_no_network_says_it_couldnt_check(self, monkeypatch):
		_hugging_face(monkeypatch, whoami=OSError("offline"))
		assert "Couldn't reach" in check_access(VALID)

	def test_a_working_token_passes(self, monkeypatch):
		_hugging_face(monkeypatch)
		assert check_access(VALID) is None


class TestSetEnvLine:
	def test_appends_to_an_empty_file(self):
		assert set_env_line("", "HF_TOKEN", VALID) == f"HF_TOKEN={VALID}\n"

	def test_replaces_rather_than_duplicates(self):
		out = set_env_line("HF_TOKEN=old\n", "HF_TOKEN", VALID)
		assert out.count("HF_TOKEN=") == 1
		assert f"HF_TOKEN={VALID}" in out

	def test_other_settings_survive(self):
		before = "FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg\nHF_TOKEN=old\n"
		out = set_env_line(before, "HF_TOKEN", VALID)
		assert "FFMPEG_BINARY=/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg" in out


class TestSaveToken:
	@pytest.fixture(autouse=True)
	def restore_env(self, monkeypatch):
		monkeypatch.setenv("HF_TOKEN", "old")  # monkeypatch restores it afterwards

	def test_writes_owner_only_applies_now_and_drops_the_old_model(self, tmp_path, monkeypatch):
		monkeypatch.setattr(diarize, "_pipeline", object())
		env = tmp_path / ".env"
		env.write_text("FFMPEG_BINARY=/usr/bin/ffmpeg\n")

		save_token(VALID, env)

		assert f"HF_TOKEN={VALID}" in env.read_text()
		assert "FFMPEG_BINARY=/usr/bin/ffmpeg" in env.read_text()
		assert env.stat().st_mode & 0o777 == 0o600
		assert os.environ["HF_TOKEN"] == VALID
		assert diarize._pipeline is None
