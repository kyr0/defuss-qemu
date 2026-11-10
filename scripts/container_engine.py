"""Explicit Docker-compatible command, with no dependency on the old workspace."""
import json
import os


def docker_command():
    command = json.loads(os.environ.get('DEFUSS_VM_DOCKER_COMMAND', '["docker"]'))
    if not isinstance(command, list) or not command or any(not isinstance(x, str) or not x for x in command):
        raise ValueError('DEFUSS_VM_DOCKER_COMMAND must be a nonempty JSON argv array')
    return command
