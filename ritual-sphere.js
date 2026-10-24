/* Decorative distribution envelope only; never an administrative or ritual boundary. */
(function (global) {
  'use strict';
  const finitePoint = point => point && Number.isFinite(point.x) && Number.isFinite(point.y);
  const cross = (a,b,c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const squareDistance = (a,b) => (a.x-b.x)**2+(a.y-b.y)**2;

  function convexHull(points) {
    const sorted=points.map(point=>({x:point.x,y:point.y})).sort((a,b)=>a.x-b.x||a.y-b.y);
    const distinct=sorted.filter((point,index)=>!index||point.x!==sorted[index-1].x||point.y!==sorted[index-1].y);
    if (distinct.length<3) return distinct;
    const lower=[],upper=[];
    for (const point of distinct) {
      while (lower.length>1&&cross(lower[lower.length-2],lower[lower.length-1],point)<=0) lower.pop();
      lower.push(point);
    }
    for (let index=distinct.length-1;index>=0;index--) {
      const point=distinct[index];
      while (upper.length>1&&cross(upper[upper.length-2],upper[upper.length-1],point)<=0) upper.pop();
      upper.push(point);
    }
    lower.pop();upper.pop();return lower.concat(upper);
  }
  function polygonArea(polygon) {
    if (polygon.length<3) return 0;
    const origin=polygon[0];
    let twice=0;
    for (let index=1;index<polygon.length-1;index++) twice+=cross(origin,polygon[index],polygon[index+1]);
    return Math.abs(twice)/2;
  }
  function segmentDistance(point,a,b) {
    const length=squareDistance(a,b);
    const t=length?Math.max(0,Math.min(1,((point.x-a.x)*(b.x-a.x)+(point.y-a.y)*(b.y-a.y))/length)):0;
    return Math.hypot(point.x-a.x-t*(b.x-a.x),point.y-a.y-t*(b.y-a.y));
  }
  function contains(point,polygon,tolerance=0) {
    if (!finitePoint(point)||!Array.isArray(polygon)||polygon.length<3) return false;
    let inside=false;
    for (let index=0,previous=polygon.length-1;index<polygon.length;previous=index++) {
      const a=polygon[previous],b=polygon[index];
      if (segmentDistance(point,a,b)<=Math.max(0,tolerance)+1e-7) return true;
      if ((a.y>point.y)!==(b.y>point.y)&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
    }
    return inside;
  }
  function nearCollinear(hull) {
    if (hull.length<3) return true;
    let a=hull[0],b=hull[1],diameter=0;
    for (let first=0;first<hull.length;first++) for (let second=first+1;second<hull.length;second++) {
      const distance=squareDistance(hull[first],hull[second]);
      if (distance>diameter) {diameter=distance;a=hull[first];b=hull[second];}
    }
    const length=Math.sqrt(diameter);
    const width=Math.max(...hull.map(point=>Math.abs(cross(a,b,point))/length));
    return width<=Math.max(20,length*.015);
  }
  function build(villages,project,coastPolygon,options={}) {
    const result={kind:'empty',count:0,pointCount:0,points:[],polygon:[],bufferMeters:0,outlineOnly:false,coastArea:0,area:0,rejectedCount:0};
    if (!Array.isArray(villages)||typeof project!=='function') return result;
    if (!Array.isArray(coastPolygon)||coastPolygon.length<3||!coastPolygon.every(finitePoint)) return {...result,rejectedCount:villages.length};
    result.coastArea=polygonArea(coastPolygon);
    if (!result.coastArea) return {...result,rejectedCount:villages.length};
    const nearCoast=Number.isFinite(options.nearCoastMeters)?Math.max(0,Math.min(180,options.nearCoastMeters)):180;
    const acceptedIds=new Set(),positions=new Set();
    for (const village of villages) {
      const point=village?.point;
      if (!['reference','survey'].includes(village?.kind)||typeof village.id!=='string'||!village.id||!Number.isFinite(point?.lng)||Math.abs(point.lng)>180||!Number.isFinite(point.lat)||Math.abs(point.lat)>90) {result.rejectedCount++;continue;}
      const key=JSON.stringify([village.kind,village.id]);
      if (acceptedIds.has(key)) continue;
      let projected;
      try {projected=project(point.lng,point.lat);} catch {result.rejectedCount++;continue;}
      if (!finitePoint(projected)||!contains(projected,coastPolygon,nearCoast)) {result.rejectedCount++;continue;}
      acceptedIds.add(key);result.count++;
      // Sub-millimetre rounding only deduplicates identical projected locations.
      const positionKey=Math.round(projected.x*1000)+':'+Math.round(projected.y*1000);
      if (positions.has(positionKey)) continue;
      positions.add(positionKey);
      result.points.push({x:projected.x,y:projected.y,key:village.key||village.kind+':'+village.id,kind:village.kind,id:village.id});
    }
    result.pointCount=result.points.length;
    if (!result.pointCount) return result;
    if (result.pointCount<3) {result.kind=result.pointCount===1?'point':'pair';return result;}
    const hull=convexHull(result.points);
    if (nearCollinear(hull)) {result.kind='degenerate';return result;}
    const buffer=Number.isFinite(options.bufferMeters)?Math.max(100,Math.min(160,options.bufferMeters)):120;
    const samples=[];
    for (const point of hull) for (let index=0;index<12;index++) {
      const angle=index*Math.PI/6;samples.push({x:point.x+Math.cos(angle)*buffer,y:point.y+Math.sin(angle)*buffer});
    }
    result.kind='polygon';result.bufferMeters=buffer;result.polygon=convexHull(samples);result.area=polygonArea(result.polygon);
    result.outlineOnly=result.area/result.coastArea>.65;
    return result;
  }
  global.RitualSphere=Object.freeze({build,contains,convexHull,polygonArea});
})(window);
