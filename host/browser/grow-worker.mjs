import {inspectFatDisk,growFatDisk} from './fat-grow.mjs';
onmessage=async({data:{file,target}})=>{
  try{
    if(target===null){postMessage({info:await inspectFatDisk(file)});return;}
    const result=await growFatDisk(file,target,(stage,done,total)=>postMessage({stage,done,total}));
    postMessage({result});
  }catch(e){postMessage({error:e.message||String(e)});}
};
