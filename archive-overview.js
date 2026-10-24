/* Summaries are derived from the same visible catalogs; maintenance stays editor-only. */
window.createArchiveOverview = options => {
  const $=id=>document.getElementById(id),people=options.people,faith=options.faith;
  let loadId=0,maintenance=null,maintenanceError='';
  function duplicatePairs(records,field){
    const names=records.filter(record=>!record.archivedAt).map(record=>new Set([record[field],record.religiousName,...(record.aliases||[])].filter(Boolean).map(value=>value.normalize('NFKC').trim().toLocaleLowerCase())));
    let count=0;for(let i=0;i<names.length;i++)for(let j=i+1;j<names.length;j++)if([...names[i]].some(name=>names[j].has(name)))count++;return count;
  }
  function render(){
    const persons=people.state?.records,deities=faith.catalog.state?.records,editable=window.NaozhouCloud?window.NaozhouCloud.editable:people.state?.editable;
    $('archive-people-count').textContent=persons?persons.length+' 份':'—';$('archive-deity-count').textContent=deities?deities.length+' 份':'—';
    $('archive-maintenance').hidden=!editable;
    if(!editable){maintenance=null;return;}
    const pending=faith.records?faith.records.reduce((sum,record)=>sum+(record.deities||[]).filter((_name,index)=>!(record.deityLinks||[]).some(link=>link.nameIndex===index)).length,0):null;
    $('archive-pending-count').textContent=pending===null?'—':String(pending);
    $('archive-duplicate-count').textContent=persons&&deities?String(duplicatePairs(persons,'displayName')+duplicatePairs(deities,'name')):'—';
    $('archive-archived-count').textContent=persons&&deities?String([...persons,...deities].filter(record=>record.archivedAt).length):'—';
    if(maintenance?.stats){const stats=maintenance.stats;for(const [id,key] of [['archive-pending-count','pendingLinks'],['archive-duplicate-count','duplicatePairs'],['archive-archived-count','archived']])if(Number.isInteger(stats[key]))$(id).textContent=String(stats[key]);}
    $('archive-maintenance-status').textContent=maintenanceError;
  }
  async function load(){
    const editable=window.NaozhouCloud?window.NaozhouCloud.editable:people.state?.editable;if(!editable)return;
    const serial=++loadId;try{const response=await(window.NaozhouCloud?.request||fetch)('/api/archive-management',{cache:'no-store'});if(!response.ok)throw Error('维护概览暂未读取');const data=await response.json();if(serial===loadId){maintenance=data;maintenanceError='';}}
    catch(error){if(serial===loadId)maintenanceError=error.message;}if(serial===loadId)render();
  }
  people.subscribe(render);faith.catalog.subscribe(render);faith.subscribe(render);
  document.addEventListener('naozhou-access-change',()=>{++loadId;maintenance=null;maintenanceError='';render();if(!$('data-panel').hidden)load();});
  document.addEventListener('naozhou-archive-change',()=>{maintenance=null;load();render();});
  new MutationObserver(()=>{if(!$('data-panel').hidden){render();load();}}).observe($('data-panel'),{attributes:true,attributeFilter:['hidden']});
  $('archive-open-layers').addEventListener('click',options.onLayers);
  $('archive-open-journal').addEventListener('click',options.onJournal);
  render();return {refresh:load};
};
