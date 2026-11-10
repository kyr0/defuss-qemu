// Render changing screens at the selected rate. Back off only repeated
// identical frames: disk activity must not hide application redraws.
export class DisplayCadence {
  constructor(){this.same=0;}
  observe(f){if(f)this.same=f.dirtyH?0:Math.min(this.same+1,4);}
  period(mode,ioBusy,inputAge,activeAge,responsiveHz=30){
    if(mode==='copy')return 500;
    const activePeriod=1000/([20,30,60].includes(responsiveHz)?responsiveHz:30);
    if(mode!=='auto')return activeAge<1250?activePeriod:120;
    if(inputAge<350 || this.same<2)return activePeriod;
    return [85,120,160][this.same-2];
  }
}
