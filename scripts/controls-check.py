"""Regression checks for model selection, prompt values, bulk paste and cancellation.

Use a separate QA server/data directory; this script saves and cancels drafts.
It never starts a model session. Screenshots are written under /tmp.
"""
import os
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE=os.environ.get('HUB_QA_URL','http://localhost:4320')
OUT=Path('/tmp/gpt-hub-controls-check');OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    scenarios=[('chromium',None),('webkit',None),('firefox',None),('webkit','iPhone SE (3rd gen)')]
    for engine,device in scenarios:
        label=engine+('-phone' if device else '')
        browser=getattr(p,engine).launch()
        context=browser.new_context(**(p.devices[device] if device else {'viewport':{'width':1440,'height':1000}}))
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(BASE+'/new')
        expect(page.get_by_label('Model',exact=True)).to_be_visible()
        assert page.locator('datalist').count()==0
        values=page.get_by_label('Model',exact=True).locator('option').evaluate_all('(options)=>options.map(o=>o.value)')
        assert len(values)>3 and values.count('gpt-6.1-sol')==1, values
        page.get_by_label('Model',exact=True).select_option('gpt-6-astra')
        page.get_by_label('Runner',exact=True).select_option('claude')
        for model in ['claude-sonnet-5-5','claude-opus-5-5','claude-haiku-5-5']:
            page.get_by_label('Model',exact=True).select_option(model)
            expect(page.get_by_label('Model',exact=True)).to_have_value(model)
        page.get_by_label('Model',exact=True).select_option('__custom__')
        page.get_by_label('Custom model ID',exact=True).fill('a-custom-model')
        expect(page.get_by_label('Custom model ID',exact=True)).to_have_value('a-custom-model')
        page.get_by_label('Model',exact=True).select_option('claude-haiku-5-5')
        name='Source edit · '+label
        page.get_by_label('Experiment name',exact=True).fill(name)
        page.get_by_label('Base prompt',exact=True).fill('SOURCE: {{SOURCE}}\nBuild a game inspired by {{SOURCE}}.\n{{TESTING}}')
        page.get_by_label('Source game 1',exact=True).fill('StarFox 64')
        source=page.locator('[data-axis-key="SOURCE"]')
        expect(source.locator('.axis-summary')).to_have_text('StarFox 64')
        page.get_by_role('button',name='Inspect matrix',exact=True).click()
        expect(page.locator('.prompt-preview')).to_contain_text('SOURCE: StarFox 64')
        expect(page.locator('.prompt-preview')).not_to_contain_text('Doom')
        page.get_by_role('button',name='Save as draft',exact=True).click()
        expect(page.get_by_role('heading',name=name,exact=True)).to_be_visible()
        page.goto(BASE+'/experiments')
        card=page.locator('.experiment-card').filter(has=page.get_by_role('heading',name=name,exact=True))
        card.get_by_role('button',name='Cancel 2 queued',exact=True).click()
        expect(card.locator('.badge')).to_have_text('cancelled')
        expect(card.get_by_role('button',name='Cancel 2 queued',exact=True)).to_have_count(0)

        page.goto(BASE+'/new')
        page.get_by_label('Experiment name',exact=True).fill('Bulk list · '+label)
        page.get_by_label('Base prompt',exact=True).fill('SOURCE: {{SOURCE}}\n{{TESTING}}')
        source=page.locator('[data-axis-key="SOURCE"]')
        source.get_by_role('button',name='Paste a list',exact=True).click()
        page.get_by_label('Pasted options for Source game',exact=True).fill('StarFox 64\nQuake (1996)\nHalf-Life (1998)')
        expect(source.locator('.bulk-preview')).to_contain_text('3 options ready')
        page.get_by_role('button',name='Inspect matrix',exact=True).click()
        expect(page.get_by_role('alert')).to_contain_text('Apply or clear the pasted list')
        source.get_by_role('button',name='Replace with 3 options',exact=True).click()
        expect(page.get_by_label('Source game 1',exact=True)).to_have_value('StarFox 64')
        expect(source.locator('.option-editor')).to_have_count(3)
        expect(page.locator('.plan-number')).to_contain_text('6')
        page.get_by_label('How to apply Source game list',exact=True).select_option('append')
        page.get_by_label('Pasted options for Source game',exact=True).fill('Quake (1996)\nSuper Metroid')
        source.get_by_role('button',name='Add 2 options',exact=True).click()
        expect(source.locator('.option-editor')).to_have_count(4)
        expect(page.locator('.plan-number')).to_contain_text('8')
        page.get_by_role('button',name='Inspect matrix',exact=True).click()
        expect(page.get_by_role('heading',name='8 runs, ready to inspect',exact=True)).to_be_visible()
        expect(page.locator('.prompt-preview')).not_to_contain_text('Doom')
        page.get_by_role('button',name='Save as draft',exact=True).click()
        expect(page.get_by_role('heading',name='Bulk list · '+label,exact=True)).to_be_visible()
        page.goto(BASE+'/new')
        page.get_by_label('Experiment name',exact=True).fill('Another draft · '+label)
        page.get_by_role('button',name='Save as draft',exact=True).click()
        expect(page.get_by_role('heading',name='Another draft · '+label,exact=True)).to_be_visible()
        page.goto(BASE+'/experiments')
        page.screenshot(path=str(OUT/(label+'-cancel.png')),full_page=True)
        page.get_by_role('button',name='Cancel all 10 queued',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Cancelled 10 queued runs')
        expect(page.get_by_role('button',name='Cancel all 10 queued',exact=True)).to_have_count(0)
        page.goto(BASE+'/new')
        page.get_by_label('Source game 1',exact=True).fill('StarFox 64')
        page.screenshot(path=str(OUT/(label+'-builder.png')),full_page=True)
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Horizontal overflow'
        assert not errors, errors
        print(json.dumps({'browser':label,'result':'PASS: model choices, source prompt, bulk replace/append, pending-paste guard, card/global cancellation','errors':errors}),flush=True)
        browser.close()
