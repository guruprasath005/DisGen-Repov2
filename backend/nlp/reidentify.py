"""
Re-identification: replace placeholders back with original PHI values.

Must run BEFORE writing structured data to the database.
The DB must never store a de-identified structured report.
"""


def reidentify(text: str, replacements_map: dict[str, str]) -> str:
    """
    Replace all placeholders in text with their original PHI values.

    Sorts replacements by placeholder length descending to prevent
    partial-key conflicts (e.g. {{PATIENT_FULL_NAME}} before {{PATIENT}}).
    """
    if not replacements_map:
        return text

    for placeholder in sorted(replacements_map, key=len, reverse=True):
        original = replacements_map[placeholder]
        text = text.replace(placeholder, original)

    return text
