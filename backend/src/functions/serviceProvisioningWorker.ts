import { app,type InvocationContext } from "@azure/functions";
import { processServiceProvisioning } from "../serviceProvisioning.js";

app.storageQueue("serviceProvisioningWorker",{
  queueName:"service-provisioning",
  connection:"AzureWebJobsStorage",
  handler:async(message:unknown,context:InvocationContext)=>{
    const parsed=typeof message==="string"?JSON.parse(message):message as {jobId?:string};
    if(!parsed?.jobId)throw new Error("Provisioning message is missing jobId.");
    await processServiceProvisioning(parsed.jobId,context);
  },
});
