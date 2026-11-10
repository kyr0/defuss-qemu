// Visual selectors for the supplied cooking ISO's unmodified 1024x768 theme.
// These synchronize input; the acceptance oracle remains the guest disk file.
export function slitazUI(canvas) {
  if(canvas.width!==1024||canvas.height!==768)return {};
  const data=canvas.getContext('2d').getImageData(0,0,1024,768).data;
  const pixel=(x,y)=>{const i=4*(y*1024+x);return [data[i],data[i+1],data[i+2]];};
  const near=(p,q)=>p.every((v,i)=>Math.abs(v-q[i])<12);
  function border(top,left,right) {
    for(let y=top;y<top+10;y++) {
      const ref=pixel(left,y);
      if(!(ref[0]>130&&ref[1]>75&&ref[0]>ref[1]*1.25&&ref[2]<110))continue;
      let same=0,total=0;
      for(let x=left;x<right;x+=20){total++;if(near(pixel(x,y),ref))same++;}
      if(same/total>0.9)return true;
    }
    return false;
  }
  function count(x0,y0,x1,y1,match) {
    let n=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(match(...pixel(x,y)))n++;
    return n;
  }
  const terminal=border(57,20,760);
  const green=count(0,65,180,90,(r,g,b)=>g>100&&g>r*1.3&&g>b*1.2);
  const blue=count(0,65,180,90,(r,g,b)=>b>110&&b>r*1.4);
  const white=count(0,88,115,108,(r,g,b)=>r>125&&g>125&&b>125&&Math.max(r,g,b)-Math.min(r,g,b)<45);
  const red=count(0,85,65,250,(r,g,b)=>r>140&&r>g*1.8&&r>b*1.5);
  return {
    welcome:border(100,200,840)&&near(pixel(700,400),[41,44,49])&&near(pixel(800,400),[41,44,49]),
    shell:terminal&&green>20&&blue>20,
    password:terminal&&white>40,
    root:terminal&&red>30,
    terminal,green,blue,white,red,
  };
}
