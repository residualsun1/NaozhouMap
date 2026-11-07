/* Shared archive layout: keep the existing index and document mounted. */
window.ArchiveLayout = (() => {
  'use strict';
  function mount(root) {
    const panels=root.querySelector('.archive-index-panels'),toggle=root.querySelector('.archive-index-toggle');
    const desktop=matchMedia('(min-width:801px)');let collapsed=false;
    function sync() {
      const hidden=collapsed&&desktop.matches;
      if(hidden&&panels.contains(document.activeElement))toggle.focus({preventScroll:true});
      root.classList.toggle('is-index-collapsed',hidden);
      panels.inert=hidden;panels.setAttribute('aria-hidden',String(hidden));
      toggle.setAttribute('aria-expanded',String(!hidden));
      toggle.querySelector('span').textContent=hidden?'展开索引':'收起索引';
    }
    toggle.addEventListener('click',()=>{collapsed=!collapsed;sync();});
    desktop.addEventListener('change',sync);sync();
  }
  return {mount};
})();
