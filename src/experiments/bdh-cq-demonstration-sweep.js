export async function runBdhCqDemonstrationSweep({ task, reasoningBudget, execute }) {
  const runs=[]; for(const demonstrationCount of [1,2,3]) { try { const result=await execute({task,reasoningBudget,demonstrationCount,backend:'bdh-cq-inspired'}); if(result?.metadata?.evidenceLevel!=='LIVE') throw new Error(); runs.push(result); } catch { runs.push({demonstrationCount,reasoningBudget,status:'ERROR',evidenceLevel:'LIVE_ERROR',error:{message:'The live BDH-CQ-inspired run failed.'}}); } }
  return {task,reasoningBudget,variable:'demonstrationCount',fixed:['query','seed','precision','parameters','truth solver','evaluation'],runs};
}
