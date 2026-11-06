from .local import LocalRunner
from .cloud import CloudRunner

RUNNERS = {"local": LocalRunner(), "cloud": CloudRunner()}
