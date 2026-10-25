// Read-only smoke check against the running local application; never generates AI.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright');
const {makeFixture}=require('./fixtures/campus-demo.cjs');
(async()=>{
  const fixture=makeFixture(),origin='http://127.0.0.1:5173',dir='docs/evidence/campus-demo';
  fs.mkdirSync(dir,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.SPM_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1440,height:900}});
    assert.equal((await context.request.post(origin+'/api/auth/login',{headers:{'X-SPM-Request':'1'},data:{username:'campus_pm',password:process.env.DEMO_SEED_PASSWORD||'SpmDemo!2026'}})).status(),201);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    // Any accidental analysis submission fails visibly instead of charging a model.
    await page.route('**/api/**',async route=>{const req=route.request();if(req.method()==='POST'&&/\/ai\//.test(req.url()))throw new Error('AI generation forbidden in browser smoke');await route.continue();});
    await page.goto(origin);await page.getByRole('button',{name:fixture.names[0],exact:true}).waitFor();
    const shot=async name=>{await page.screenshot({path:`${dir}/${name}.png`,animations:'disabled'});console.log('PASS 1440x900 '+name);};
    await shot('projects');await page.getByRole('button',{name:fixture.names[0],exact:true}).click();await page.getByRole('heading',{name:fixture.names[0],exact:true}).waitFor();await page.waitForLoadState('networkidle');await shot('overview');
    const nav=async name=>{await page.locator('.sidebar').getByRole('button',{name,exact:true}).click();await page.waitForLoadState('networkidle');};
    await nav('需求管理');await page.getByRole('button',{name:'全部展开',exact:true}).click();assert.equal(await page.locator('.b-req-tree tbody tr').count(),24);await shot('requirements');
    await nav('项目计划');await page.locator('.stagecard').first().waitFor();assert.equal(await page.locator('.stagecard').count(),5);await page.locator('.stagecard').filter({hasText:'开发与联调'}).click();await shot('plan-overview');await page.getByRole('button',{name:'甘特图',exact:true}).click();await page.locator('.gv-fixed-row').first().waitFor();await shot('gantt');
    await nav('多视图工作台');await page.getByRole('tab',{name:'故事地图',exact:true}).click();await page.locator('.story-map').waitFor();await shot('story-map');
    await nav('成员与角色');await shot('members');await nav('项目文档');await page.locator('.a-docs .file-table-scroll').waitFor();await shot('documents');
    assert.deepEqual(errors,[]);fs.writeFileSync(`${dir}/verification.json`,JSON.stringify({result:'PASS',viewport:{width:1440,height:900},checks:['projects','overview','24 requirements','five stages','gantt','story map','members','documents'],browserErrors:errors,aiCalls:0},null,2));
    await context.request.post(origin+'/api/auth/logout',{headers:{'X-SPM-Request':'1'}});
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
