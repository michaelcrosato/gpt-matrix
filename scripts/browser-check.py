"""End-to-end verification against a separate QA data directory.

Run the app on port 4320 with HUB_DATA_DIR=/tmp/gpt-hub-qa first.
Requires the machine's preinstalled Python Playwright. Writes screenshots to /tmp.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('HUB_QA_URL', 'http://localhost:4320')
OUT = Path('/tmp/gpt-hub-browser-qa')
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    for engine in os.environ.get('HUB_QA_ENGINES', 'chromium,webkit,firefox').split(','):
        browser = getattr(p, engine).launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 1000})
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(BASE + '/#new')
        expect(page.get_by_label('Experiment name', exact=True)).to_be_visible()
        page.get_by_label('Experiment name', exact=True).fill('BROWSER QA · ' + engine)
        page.get_by_label('Base prompt', exact=True).fill('Local rehearsal for {{SOURCE}}. {{TESTING}}')
        page.get_by_label('Runner', exact=True).select_option('rehearsal')
        page.get_by_label('Repetitions per combination').fill('2')
        page.get_by_role('button', name='Inspect matrix', exact=True).click()
        expect(page.get_by_role('heading', name='4 runs, ready to inspect')).to_be_visible()
        page.screenshot(path=str(OUT / f'{engine}-matrix.png'), full_page=True)
        page.get_by_role('button', name='Save as draft', exact=True).click()
        expect(page.get_by_role('heading', name='BROWSER QA · ' + engine)).to_be_visible()
        page.get_by_role('button', name='Start experiment', exact=True).click()
        expect(page.locator('tbody .badge.completed')).to_have_count(4, timeout=15000)
        page.get_by_role('button', name='Doom (1993)').first.click()
        expect(page.get_by_role('link', name='Open output', exact=True)).to_be_visible()
        with context.expect_page() as popup:
            page.get_by_role('link', name='Open output', exact=True).click()
        output = popup.value
        output.get_by_role('button', name='Try the interaction').click()
        expect(output.get_by_role('button', name='Interaction verified ✓')).to_be_visible()
        output.close()
        page.get_by_role('button', name='Human review', exact=True).click()
        page.get_by_role('radio', name='Pass', exact=True).check()
        page.get_by_label('Overall quality (1–5)').select_option('4')
        page.get_by_label('Actual technology used').fill('HTML + CSS + JavaScript')
        page.get_by_label('Playtest notes').fill('Verified output interaction in ' + engine)
        page.get_by_label('Game fails to boot outcome').select_option('clear')
        page.get_by_label('Game fails to boot check minutes').fill('0.5')
        page.get_by_label('Controller axes inverted outcome').select_option('found')
        page.get_by_label('Controller axes inverted fix minutes').fill('2')
        page.get_by_role('button', name='Save review', exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Human review saved')
        page.reload()
        page.get_by_role('button', name='Human review', exact=True).click()
        expect(page.get_by_label('Playtest notes')).to_have_value('Verified output interaction in ' + engine)
        expect(page.get_by_label('Game fails to boot outcome')).to_have_value('clear')
        page.screenshot(path=str(OUT / f'{engine}-review.png'), full_page=True)
        page.get_by_role('button', name='Exact prompt', exact=True).click()
        expect(page.locator('.prompt-preview')).to_contain_text('Local rehearsal for Doom (1993).')
        page.get_by_role('button', name='Activity & logs', exact=True).click()
        expect(page.locator('.event-list')).to_contain_text('Run completed.')
        page.goto(BASE + '/#insights')
        page.get_by_label('Include local rehearsal fixtures').check()
        expect(page.locator('.comparison-table')).to_be_visible()
        page.get_by_role('button', name='Issue frequency', exact=True).click()
        expect(page.get_by_role('cell', name='Controller axes inverted', exact=True)).to_be_visible()
        page.get_by_role('button', name='Agent feedback', exact=True).click()
        expect(page.locator('.feedback-card').first).to_be_visible()
        page.goto(BASE + '/#settings')
        expect(page.get_by_role('heading', name='Connected CLIs')).to_be_visible()
        assert not errors, errors
        print(json.dumps({'engine': engine, 'flow': 'PASS', 'console_errors': errors}), flush=True)
        browser.close()
