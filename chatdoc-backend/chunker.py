"""
Legal document chunker — clause-aware splitting.
Extracted from Untitled.ipynb and hardened for production use.
"""

import re
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class Clause:
    header: str
    body: str
    start_line: int
    end_line: int


HEADER_PATTERNS = [
    r"^\s*(ARTICLE|Article)\s+([IVXLC]+|\d+)\b.*$",
    r"^\s*(SECTION|Section)\s+\d+(\.\d+)*\b.*$",
    r"^\s*\d+\s+.+$",
    r"^\s*\d+\.\s+.+$",
    r"^\s*\d+\)\s+.+$",
    r"^\s*\d+\s*-\s+.+$",
    r"^\s*\d+(\.\d+){1,}\s+.+$",
    r"^\s*\(\s*[a-z]\s*\)\s+.+$",
    r"^\s*\(\s*(i|ii|iii|iv|v|vi|vii|viii|ix|x)\s*\)\s+.+$",
    r"^\s*[A-Z]\.\s+.+$",
]
HEADER_RE = re.compile("|".join(f"(?:{p})" for p in HEADER_PATTERNS))

# Maximum characters per chunk (safety valve).
# BGE-base truncates at ~512 tokens ≈ 1500–2000 chars; keeping chunks under
# 6000 chars preserves context while staying well within Milvus VARCHAR limits.
MAX_CHUNK_CHARS = 6000


def _force_split(text: str, max_chars: int) -> list:
    """Split text into pieces of at most max_chars, breaking at word boundaries."""
    parts = []
    while len(text) > max_chars:
        idx = text.rfind(" ", 0, max_chars)
        if idx <= 0:
            idx = max_chars  # no space found — hard split
        parts.append(text[:idx])
        text = text[idx:].lstrip()
    if text:
        parts.append(text)
    return parts


def normalize_contract_text(text: str) -> str:
    """Fix common PDF extraction artifacts."""
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)   # unhyphenate line breaks
    text = re.sub(r"[ \t]+", " ", text)              # collapse horizontal whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)           # collapse blank lines
    return text.strip()


def clause_chunk(text: str) -> List[Clause]:
    """Split legal text into clause-level chunks."""
    text = normalize_contract_text(text)
    lines = text.splitlines()

    clauses: List[Clause] = []
    cur_header: Optional[str] = None
    cur_body_lines: List[str] = []
    cur_start = 0

    def flush(end_idx: int):
        nonlocal cur_header, cur_body_lines, cur_start
        if cur_header is None and not cur_body_lines:
            return
        header = cur_header or "Preamble/Unlabeled"
        body = "\n".join(cur_body_lines).strip()
        if body:
            clauses.append(Clause(
                header=header.strip(),
                body=body,
                start_line=cur_start,
                end_line=end_idx,
            ))
        cur_header = None
        cur_body_lines = []

    for i, line in enumerate(lines):
        if HEADER_RE.match(line) and len(line.strip()) <= 160:
            flush(i - 1)
            cur_header = line.strip()
            cur_start = i
        else:
            cur_body_lines.append(line)

    flush(len(lines) - 1)

    # Safety: split oversized clauses into sub-chunks
    result: List[Clause] = []
    for clause in clauses:
        combined = clause.header + "\n" + clause.body
        if len(combined) <= MAX_CHUNK_CHARS:
            result.append(clause)
        else:
            # Split by paragraph within the clause; force-split any paragraph
            # that is itself larger than MAX_CHUNK_CHARS (e.g. dense legal prose
            # with no blank lines), which the original `and buf` guard missed.
            raw_paras = clause.body.split("\n\n")
            paragraphs: List[str] = []
            for p in raw_paras:
                if len(p) > MAX_CHUNK_CHARS:
                    paragraphs.extend(_force_split(p, MAX_CHUNK_CHARS))
                else:
                    paragraphs.append(p)

            buf: List[str] = []
            buf_len = len(clause.header) + 1
            sub_idx = 0
            for para in paragraphs:
                if buf_len + len(para) > MAX_CHUNK_CHARS and buf:
                    result.append(Clause(
                        header=f"{clause.header} (part {sub_idx + 1})",
                        body="\n\n".join(buf),
                        start_line=clause.start_line,
                        end_line=clause.end_line,
                    ))
                    sub_idx += 1
                    buf = [para]
                    buf_len = len(clause.header) + len(para) + 1
                else:
                    buf.append(para)
                    buf_len += len(para) + 2
            if buf:
                label = f" (part {sub_idx + 1})" if sub_idx > 0 else ""
                result.append(Clause(
                    header=f"{clause.header}{label}",
                    body="\n\n".join(buf),
                    start_line=clause.start_line,
                    end_line=clause.end_line,
                ))
    return result


def extract_chunks(text: str) -> List[dict]:
    """
    Return list of dicts ready for Milvus insertion.
    Each dict: {header, text, chunk_index}
    """
    clauses = clause_chunk(text)
    return [
        {
            "header": c.header,
            "text": (c.header + "\n" + c.body),
            "chunk_index": i,
        }
        for i, c in enumerate(clauses)
    ]
