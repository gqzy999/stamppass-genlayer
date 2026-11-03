import importlib.util
import sys
import types
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _reset_stub():
    clear_web()
    set_sender("0x" + "a" * 40)
    yield
    clear_web()


class _UserError(Exception):
    def __init__(self, data):
        super().__init__(data)
        self.data = data


class _TreeMap(dict):
    def __class_getitem__(cls, item):
        return cls


class _Response:
    def __init__(self, status, body):
        self.status = status
        self.body = body


class _Web:
    def __init__(self):
        self.routes = {}

    def get(self, url):
        if url not in self.routes:
            raise Exception("no mock for " + url)
        value = self.routes[url]
        if isinstance(value, Exception):
            raise value
        status, body = value
        if isinstance(body, str):
            body = body.encode("utf-8")
        return _Response(status, body)


class _EqPrinciple:
    def strict_eq(self, fn):
        return fn()


class _Message:
    def __init__(self):
        self.sender_address = "0x" + "a" * 40


class _Public:
    def write(self, fn):
        return fn

    def view(self, fn):
        return fn


def _run_nondet_unsafe(leader_fn, validator_fn):
    result = leader_fn()
    if not validator_fn(result):
        raise Exception("consensus failed")
    return result


def _unpack_result(res):
    return res


class _Gl:
    def __init__(self):
        self.Contract = object
        self.public = _Public()
        self.vm = types.SimpleNamespace(
            UserError=_UserError,
            run_nondet_unsafe=_run_nondet_unsafe,
            unpack_result=_unpack_result,
        )
        self.message = _Message()
        self.nondet = types.SimpleNamespace(web=_Web())
        self.eq_principle = _EqPrinciple()


GL = _Gl()


def _allow_storage(cls):
    return cls


def _install_stub():
    mod = types.ModuleType("genlayer")
    mod.__all__ = ["gl", "TreeMap", "u32", "Address", "allow_storage"]
    mod.gl = GL
    mod.TreeMap = _TreeMap
    mod.u32 = int
    mod.Address = str
    mod.allow_storage = _allow_storage
    sys.modules["genlayer"] = mod


_install_stub()


def load_contract():
    path = Path(__file__).resolve().parent.parent / "contracts" / "stamppass.py"
    spec = importlib.util.spec_from_file_location("stamppass_contract", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fresh_contract():
    module = load_contract()
    contract = module.StampPass()
    contract.claims = {}
    contract.claim_index = {}
    contract.stamps = {}
    contract.stamp_index = {}
    contract.claimer_claim_count = {}
    contract.dup_guard = {}
    return contract


def set_sender(address):
    GL.message.sender_address = address


def mock_web(url, status, body):
    GL.nondet.web.routes[url] = (status, body)


def mock_web_error(url, exc):
    GL.nondet.web.routes[url] = exc


def clear_web():
    GL.nondet.web.routes.clear()
