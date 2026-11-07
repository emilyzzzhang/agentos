"""Coarse source-type labels for web results, used as hints for the agents and shown in the report.

This is a heuristic from the URL only. It never removes a source; it helps Milo and Luna prefer
primary documentation, standards and papers over blogs and forums when several sources say the same.
"""
from __future__ import annotations

from typing import Literal
from urllib.parse import urlparse

SourceType = Literal["official", "standard", "paper", "reference", "news", "community", "other"]

LABELS: dict[str, str] = {
    "official": "official docs", "standard": "standard/spec", "paper": "paper", "reference": "reference",
    "news": "news", "community": "blog/forum", "other": "web page",
}

_COMMUNITY = ("medium.com", "dev.to", "hashnode.dev", "hashnode.com", "substack.com", "reddit.com", "quora.com",
              "stackoverflow.com", "stackexchange.com", "linkedin.com", "youtube.com", "towardsdatascience.com",
              "geeksforgeeks.org", "blogspot.com", "wordpress.com", "tumblr.com", "freecodecamp.org",
              "hackernoon.com", "dzone.com", "glassdoor.com", "leetcode.com/discuss", "news.ycombinator.com")
_STANDARD = ("ietf.org", "rfc-editor.org", "w3.org", "whatwg.org", "iso.org", "ecma-international.org", "nist.gov",
             "owasp.org", "unicode.org", "khronos.org")
_PAPER = ("arxiv.org", "acm.org", "ieee.org", "springer.com", "sciencedirect.com", "nature.com", "usenix.org",
          "researchgate.net", "semanticscholar.org", "openreview.net", "vldb.org", "nih.gov")
_REFERENCE = ("wikipedia.org", "mozilla.org", "britannica.com")
_NEWS = ("reuters.com", "bloomberg.com", "techcrunch.com", "theverge.com", "arstechnica.com", "wired.com",
         "infoq.com", "thenewstack.io", "zdnet.com", "venturebeat.com")
# Project/vendor sites whose pages are first-party documentation.
_OFFICIAL_HOSTS = ("postgresql.org", "python.org", "nodejs.org", "kubernetes.io", "apache.org", "kafka.apache.org",
                   "rabbitmq.com", "mongodb.com", "redis.io", "react.dev", "reactjs.org", "nextjs.org", "remix.run",
                   "vuejs.org", "angular.dev", "rust-lang.org", "go.dev", "golang.org", "oracle.com", "microsoft.com",
                   "learn.microsoft.com", "aws.amazon.com", "cloud.google.com", "developer.apple.com", "anthropic.com",
                   "docker.com", "djangoproject.com", "fastapi.tiangolo.com", "qdrant.tech", "sqlite.org",
                   "mysql.com", "elastic.co", "confluent.io", "github.blog", "typescriptlang.org", "vitejs.dev",
                   "tailwindcss.com", "langchain.com", "python.langchain.com", "pytorch.org", "tensorflow.org")


def _matches(host: str, path: str, entries: tuple[str, ...]) -> bool:
    full = host + path
    return any(host == e or host.endswith("." + e) or full.startswith(e) for e in entries)


def classify(url: str) -> SourceType:
    try:
        u = urlparse(url)
    except ValueError:
        return "other"
    host = (u.hostname or "").lower().removeprefix("www.")
    path = (u.path or "").lower()
    if not host:
        return "other"
    first = host.split(".")[0]
    # Forums and community sections on vendor sites are not first-party documentation.
    if (_matches(host, path, _COMMUNITY) or first in ("community", "forum", "forums", "discuss", "discussions")
            or any(seg in path for seg in ("/community/", "/forum/", "/forums/", "/discuss/", "/t/"))):
        return "community"
    if _matches(host, path, _STANDARD):
        return "standard"
    if _matches(host, path, _PAPER) or path.endswith(".pdf") and ("paper" in path or "proceedings" in path):
        return "paper"
    if _matches(host, path, _REFERENCE):
        return "reference"
    if _matches(host, path, _NEWS):
        return "news"
    if (first in ("docs", "doc", "developer", "developers", "learn", "dev", "api", "reference", "help", "support", "manual")
            or any(seg in path for seg in ("/docs/", "/documentation/", "/manual/", "/reference/", "/api-reference/", "/handbook/"))
            or _matches(host, path, _OFFICIAL_HOSTS)):
        return "official"
    if host.endswith((".gov", ".edu")):
        return "reference"
    if host == "github.com":  # a project's own repository is first-party; issues/discussions are not
        return "community" if any(s in path for s in ("/issues", "/discussions")) else "official"
    if "blog" in host or "/blog" in path:
        return "community"
    return "other"


def label(url: str) -> str:
    return LABELS[classify(url)]
