"use client";

import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {AZURE_SERVICE_CATALOG,formatServiceUnits} from "@/lib/azure-catalog";
import {
  acknowledgeServiceMessage,createMonitoringEvent,createServiceJob,deleteDatabaseRecord,deleteServiceBlob,
  downloadServiceBlob,getServiceConsoleStatus,listDatabaseRecords,listMonitoringEvents,listServiceBlobs,
  listServiceJobs,publishServiceMessage,receiveServiceMessages,saveDatabaseRecord,uploadServiceBlob,
  type AzureServiceType,type ServiceBlobObject,type ServiceConsoleStatus,type ServiceDatabaseRecord,
  type ServiceEntitlement,type ServiceJob,type ServiceMessage,type ServiceMonitorEvent,
}from "@/lib/academy-api";

type ExplorerData={
  blobs:ServiceBlobObject[];records:ServiceDatabaseRecord[];messages:ServiceMessage[];
  events:ServiceMonitorEvent[];jobs:ServiceJob[];
};
const emptyData:ExplorerData={blobs:[],records:[],messages:[],events:[],jobs:[]};
const jobServices=new Set<AzureServiceType>(["container_compute","machine_learning","functions","document_intelligence","speech_vision"]);

function Icon({name}:{name:"storage"|"database"|"message"|"monitor"|"compute"|"refresh"|"upload"|"search"|"close"|"more"}){
  const paths={
    storage:<><path d="M4 7.5h6l1.5 2H20v8.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9.5a2 2 0 0 1 2-2Z"/><path d="M2.5 11h19"/></>,
    database:<><ellipse cx="12" cy="5" rx="8.5" ry="3"/><path d="M3.5 5v6c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V5M3.5 11v6c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-6"/></>,
    message:<><path d="M4 4h16v12H8l-4 4V4Z"/><path d="M8 9h8M8 12h5"/></>,
    monitor:<><path d="M3 18h18M5 15l4-5 3 3 5-7 2 3"/></>,
    compute:<><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m9 9 3 3-3 3M14 15h2"/></>,
    refresh:<><path d="M20 7v5h-5"/><path d="M19 12a7 7 0 1 0-2 5"/></>,
    upload:<><path d="M12 16V3M7 8l5-5 5 5"/><path d="M4 14v6h16v-6"/></>,
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    close:<><path d="m6 6 12 12M18 6 6 18"/></>,
    more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}
function serviceIcon(type:AzureServiceType){
  if(type==="blob_storage")return"storage";if(type==="database")return"database";
  if(type==="messaging")return"message";if(type==="monitoring")return"monitor";return"compute";
}
function jsonText(value:unknown){return JSON.stringify(value,null,2);}
function prettyBytes(value:number){
  if(value<1024)return`${value} B`;if(value<1048576)return`${(value/1024).toFixed(1)} KB`;
  if(value<1073741824)return`${(value/1048576).toFixed(1)} MB`;return`${(value/1073741824).toFixed(2)} GB`;
}

export function ServiceExplorer({entitlements,initialId,onClose,onChanged}:{entitlements:ServiceEntitlement[];initialId:string;onClose:()=>void;onChanged:()=>void}){
  const activeEntitlements=entitlements.filter(item=>item.status==="active");
  const [selectedId,setSelectedId]=useState(initialId);
  const entitlement=activeEntitlements.find(item=>item.id===selectedId)||activeEntitlements[0];
  const type=entitlement?.service_type||"blob_storage";
  const catalog=AZURE_SERVICE_CATALOG.find(item=>item.type===type);
  const [status,setStatus]=useState<ServiceConsoleStatus|null>(null);
  const [data,setData]=useState<ExplorerData>(emptyData);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [search,setSearch]=useState("");
  const [collection,setCollection]=useState("default");
  const [collectionInput,setCollectionInput]=useState("default");
  const [topic,setTopic]=useState("default");
  const [topicInput,setTopicInput]=useState("default");
  const [editorOpen,setEditorOpen]=useState(false);
  const [recordKey,setRecordKey]=useState("");
  const [editorValue,setEditorValue]=useState("{\n  \n}");
  const [preview,setPreview]=useState<{name:string;url:string;type:string;text?:string}|null>(null);
  const fileInput=useRef<HTMLInputElement>(null);

  const load=useCallback(async()=>{
    if(!entitlement)return;
    setLoading(true);setError("");setNotice("");
    try{
      const currentStatus=await getServiceConsoleStatus(type);setStatus(currentStatus);
      if(type==="blob_storage"){const result=await listServiceBlobs();setData({...emptyData,blobs:result.objects});}
      else if(type==="database"){const result=await listDatabaseRecords(collection);setData({...emptyData,records:result.records});}
      else if(type==="messaging"){const result=await receiveServiceMessages(topic);setData({...emptyData,messages:result.messages});}
      else if(type==="monitoring"){const result=await listMonitoringEvents();setData({...emptyData,events:result.events});}
      else if(jobServices.has(type)){const result=await listServiceJobs(type as Exclude<AzureServiceType,"blob_storage"|"database"|"messaging"|"monitoring">);setData({...emptyData,jobs:result.jobs});}
    }catch(value){setError(value instanceof Error?value.message:"Service workspace could not be loaded.");}
    finally{setLoading(false);}
  },[collection,entitlement,topic,type]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>()=>{if(preview?.url)URL.revokeObjectURL(preview.url);},[preview]);
  useEffect(()=>{const handle=(event:KeyboardEvent)=>{if(event.key==="Escape"){if(preview)setPreview(null);else if(editorOpen)setEditorOpen(false);else onClose();}};window.addEventListener("keydown",handle);return()=>window.removeEventListener("keydown",handle);},[editorOpen,onClose,preview]);

  const run=async(task:()=>Promise<unknown>,message:string)=>{
    setBusy(true);setError("");setNotice("");
    try{await task();setNotice(message);await load();onChanged();}
    catch(value){setError(value instanceof Error?value.message:"The service action could not be completed.");}
    finally{setBusy(false);}
  };
  const filteredBlobs=useMemo(()=>data.blobs.filter(item=>item.name.toLowerCase().includes(search.toLowerCase())),[data.blobs,search]);
  const filteredRecords=useMemo(()=>data.records.filter(item=>item.key.toLowerCase().includes(search.toLowerCase())),[data.records,search]);

  const previewBlob=async(item:ServiceBlobObject,download=false)=>{
    setBusy(true);setError("");
    try{
      const result=await downloadServiceBlob(item.name),url=URL.createObjectURL(result.blob);
      if(download){const anchor=document.createElement("a");anchor.href=url;anchor.download=item.name.split("/").at(-1)||"download";anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
      else{
        let text:string|undefined;
        if(result.contentType.startsWith("text/")||result.contentType.includes("json")||result.contentType.includes("javascript"))text=await result.blob.text();
        setPreview({name:item.name,url,type:result.contentType,text});
      }
    }catch(value){setError(value instanceof Error?value.message:"The object could not be opened.");}
    finally{setBusy(false);}
  };
  const saveRecord=(event:FormEvent)=>{
    event.preventDefault();
    let value:unknown;try{value=JSON.parse(editorValue);}catch{setError("Record value must be valid JSON.");return;}
    void run(()=>saveDatabaseRecord(collection,recordKey.trim(),value),"Record saved.").then(()=>setEditorOpen(false));
  };

  if(!entitlement)return null;
  const used=status?.quota.used??entitlement.usage_count,limit=status?.quota.limit??entitlement.quota_limit;
  const percent=Math.min(100,limit?used/limit*100:0);

  return <div className="service-explorer-layer">
    <section className="service-explorer" role="dialog" aria-modal="true" aria-labelledby="service-explorer-title">
      <aside className="service-explorer-rail">
        <div className="service-explorer-brand"><span>BM</span><div><strong>Cloud Console</strong><small>Academy managed</small></div></div>
        <nav>{activeEntitlements.map(item=>{
          const itemCatalog=AZURE_SERVICE_CATALOG.find(entry=>entry.type===item.service_type);
          return <button key={item.id} className={item.id===entitlement.id?"active":""} onClick={()=>{setSelectedId(item.id);setSearch("");setEditorOpen(false);}}>
            <span><Icon name={serviceIcon(item.service_type)}/></span><div><strong>{itemCatalog?.shortName||item.display_name}</strong><small>{item.status}</small></div><i/>
          </button>;
        })}</nav>
        <div className="service-explorer-security"><i/><span><strong>Protected session</strong><small>Azure credentials are never exposed</small></span></div>
      </aside>

      <main className="service-explorer-main">
        <header className="service-explorer-topbar">
          <div><span className="service-breadcrumb">Cloud services <i>/</i> {catalog?.shortName}</span><h2 id="service-explorer-title">{entitlement.display_name}</h2></div>
          <div><button className="service-icon-button" onClick={()=>void load()} disabled={loading||busy} title="Refresh"><Icon name="refresh"/></button><button className="service-icon-button" onClick={onClose} title="Close"><Icon name="close"/></button></div>
        </header>

        <section className="service-overview-strip">
          <div className="service-overview-primary"><span><Icon name={serviceIcon(type)}/></span><div><small>AZURE SERVICE</small><strong>{catalog?.name}</strong><p>{catalog?.description}</p></div></div>
          <div className="service-overview-metric"><small>STATUS</small><strong className="is-live"><i/> Operational</strong><span>Academy gateway</span></div>
          <div className="service-overview-metric quota"><small>ALLOWANCE</small><strong>{formatServiceUnits(Math.max(0,limit-used),entitlement.quota_unit)}</strong><span>of {formatServiceUnits(limit,entitlement.quota_unit)} remaining</span><i><b style={{width:`${percent}%`}}/></i></div>
          <div className="service-overview-metric"><small>EXPIRES</small><strong>{entitlement.expires_at?new Date(entitlement.expires_at).toLocaleDateString():"No expiry"}</strong><span>{entitlement.expires_at?new Date(entitlement.expires_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}):"Continuous access"}</span></div>
        </section>

        <div className="service-commandbar">
          <div className="service-search"><Icon name="search"/><input value={search} onChange={event=>setSearch(event.target.value)} placeholder={`Search ${type==="blob_storage"?"objects":type==="database"?"records":"resources"}…`}/></div>
          {type==="blob_storage"&&<><input ref={fileInput} hidden type="file" multiple onChange={event=>{const files=Array.from(event.target.files||[]);void run(async()=>{for(const file of files)await uploadServiceBlob(file.name,file);},`${files.length} object${files.length===1?"":"s"} uploaded.`);event.currentTarget.value="";}}/><button className="service-primary-action" onClick={()=>fileInput.current?.click()} disabled={busy}><Icon name="upload"/>Upload objects</button></>}
          {type==="database"&&<><label className="service-inline-field"><span>Collection</span><input value={collectionInput} onChange={event=>setCollectionInput(event.target.value)} onBlur={()=>setCollection(collectionInput.trim()||"default")} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setCollection(collectionInput.trim()||"default");}}}/></label><button className="service-primary-action" onClick={()=>{setRecordKey("");setEditorValue("{\n  \n}");setEditorOpen(true);}}>+ New record</button></>}
          {type==="messaging"&&<label className="service-inline-field"><span>Topic</span><input value={topicInput} onChange={event=>setTopicInput(event.target.value)} onBlur={()=>setTopic(topicInput.trim()||"default")} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();setTopic(topicInput.trim()||"default");}}}/></label>}
          {type==="monitoring"&&<button className="service-primary-action" onClick={()=>setEditorOpen(true)}>+ Add event</button>}
          {jobServices.has(type)&&<button className="service-primary-action" onClick={()=>setEditorOpen(true)}>+ Submit job</button>}
        </div>

        {(error||notice)&&<div className={`service-console-alert ${error?"error":"success"}`}><strong>{error?"Action needs attention":"Action completed"}</strong><span>{error||notice}</span><button onClick={()=>{setError("");setNotice("");}}>×</button></div>}

        <section className="service-resource-panel">
          <header><div><h3>{type==="blob_storage"?"Objects":type==="database"?"Database records":type==="messaging"?"Messages":type==="monitoring"?"Telemetry events":"Execution jobs"}</h3><span>{type==="blob_storage"?`${data.blobs.length} objects`:type==="database"?`${data.records.length} records`:type==="messaging"?`${data.messages.length} available`:type==="monitoring"?`${data.events.length} events`:`${data.jobs.length} jobs`}</span></div><button onClick={()=>void load()} disabled={loading}><Icon name="refresh"/>Refresh</button></header>
          {loading?<div className="service-loading"><i/><strong>Loading service resources</strong><span>Connecting through the secure Academy gateway…</span></div>:
          type==="blob_storage"?<BlobTable items={filteredBlobs} busy={busy} onPreview={item=>void previewBlob(item)} onDownload={item=>void previewBlob(item,true)} onDelete={item=>void run(()=>deleteServiceBlob(item.name),`${item.name} deleted.`)}/>:
          type==="database"?<RecordTable items={filteredRecords} onEdit={item=>{setRecordKey(item.key);setEditorValue(jsonText(item.value));setEditorOpen(true);}} onDelete={item=>void run(()=>deleteDatabaseRecord(collection,item.key),`${item.key} deleted.`)}/>:
          type==="messaging"?<MessageConsole items={data.messages} topic={topic} busy={busy} onError={setError} publish={(payload)=>run(()=>publishServiceMessage(topic,payload),"Message published.")} acknowledge={id=>run(()=>acknowledgeServiceMessage(id),"Message acknowledged.")}/>:
          type==="monitoring"?<EventTable items={data.events}/>:
          <JobTable items={data.jobs}/>}
        </section>
      </main>

      {editorOpen&&<EditorPanel type={type} recordKey={recordKey} setRecordKey={setRecordKey} value={editorValue} setValue={setEditorValue} busy={busy} onClose={()=>setEditorOpen(false)} onSubmit={type==="database"?saveRecord:(event)=>{event.preventDefault();let value:unknown;try{value=JSON.parse(editorValue);}catch{setError("Input must be valid JSON.");return;}if(type==="monitoring")void run(()=>createMonitoringEvent(value),"Telemetry event accepted.").then(()=>setEditorOpen(false));else void run(()=>createServiceJob(type as Exclude<AzureServiceType,"blob_storage"|"database"|"messaging"|"monitoring">,recordKey||"run",value),"Job submitted.").then(()=>setEditorOpen(false));}}/>}
      {preview&&<PreviewPanel preview={preview} onClose={()=>setPreview(null)}/>}
    </section>
  </div>;
}

function Empty({title,message}:{title:string;message:string}){return <div className="service-empty"><span><Icon name="search"/></span><strong>{title}</strong><p>{message}</p></div>;}
function BlobTable({items,busy,onPreview,onDownload,onDelete}:{items:ServiceBlobObject[];busy:boolean;onPreview:(item:ServiceBlobObject)=>void;onDownload:(item:ServiceBlobObject)=>void;onDelete:(item:ServiceBlobObject)=>void}){
  if(!items.length)return <Empty title="No objects in this workspace" message="Upload a file to start using your Academy-managed storage."/>;
  return <div className="service-table"><div className="service-table-head"><span>Name</span><span>Type</span><span>Size</span><span>Last modified</span><span/></div>{items.map(item=><div className="service-table-row" key={item.name}><button className="service-object-name" onClick={()=>onPreview(item)}><span>{item.name.split(".").at(-1)?.slice(0,3).toUpperCase()||"FILE"}</span><div><strong>{item.name.split("/").at(-1)}</strong><small>{item.name}</small></div></button><span>{item.contentType||"Binary object"}</span><span>{prettyBytes(item.size)}</span><time>{item.updatedAt?new Date(item.updatedAt).toLocaleString():"—"}</time><div className="service-row-actions"><button onClick={()=>onPreview(item)}>Preview</button><button onClick={()=>onDownload(item)}>Download</button><button className="danger" disabled={busy} onClick={()=>{if(confirm(`Delete ${item.name}?`))onDelete(item);}}>Delete</button></div></div>)}</div>;
}
function RecordTable({items,onEdit,onDelete}:{items:ServiceDatabaseRecord[];onEdit:(item:ServiceDatabaseRecord)=>void;onDelete:(item:ServiceDatabaseRecord)=>void}){
  if(!items.length)return <Empty title="No records in this collection" message="Create a JSON record or change the selected collection."/>;
  return <div className="service-record-grid">{items.map(item=><article key={item.key}><header><span>{item.key.slice(0,2).toUpperCase()}</span><div><strong>{item.key}</strong><small>Updated {new Date(item.updated_at).toLocaleString()}</small></div><Icon name="more"/></header><pre>{jsonText(item.value)}</pre><footer><button onClick={()=>onEdit(item)}>Open editor</button><button className="danger" onClick={()=>{if(confirm(`Delete ${item.key}?`))onDelete(item);}}>Delete</button></footer></article>)}</div>;
}
function MessageConsole({items,topic,busy,onError,publish,acknowledge}:{items:ServiceMessage[];topic:string;busy:boolean;onError:(message:string)=>void;publish:(payload:unknown)=>Promise<void>;acknowledge:(id:string)=>Promise<void>}){
  const [value,setValue]=useState("{\n  \"message\": \"Hello\"\n}");
  return <div className="service-split-console"><form onSubmit={event=>{event.preventDefault();try{void publish(JSON.parse(value));}catch{onError("Message payload must be valid JSON.");}}}><span>PUBLISH TO <b>{topic}</b></span><textarea value={value} onChange={event=>setValue(event.target.value)}/><button disabled={busy}>Publish message</button></form><div>{items.map(item=><article key={item.id}><header><strong>{item.topic}</strong><time>{new Date(item.created_at).toLocaleString()}</time></header><pre>{jsonText(item.payload)}</pre><button disabled={busy} onClick={()=>void acknowledge(item.id)}>Acknowledge</button></article>)}{!items.length&&<Empty title="Queue is clear" message="Published messages will appear here until acknowledged."/>}</div></div>;
}
function EventTable({items}:{items:ServiceMonitorEvent[]}){return items.length?<div className="service-event-list">{items.map(item=><article key={item.id}><i/><div><strong>{typeof item.value==="object"&&item.value&&"level" in item.value?String((item.value as {level:unknown}).level):"Telemetry event"}</strong><pre>{jsonText(item.value)}</pre></div><time>{new Date(item.created_at).toLocaleString()}</time></article>)}</div>:<Empty title="No telemetry events" message="Send an event to begin building this service timeline."/>;}
function JobTable({items}:{items:ServiceJob[]}){return items.length?<div className="service-job-list">{items.map(item=><article key={item.id}><span className={`service-job-status ${item.status}`}><i/>{item.status}</span><div><strong>{item.operation}</strong><small>{item.id}</small></div><time>{new Date(item.created_at).toLocaleString()}</time>{item.error_message&&<p>{item.error_message}</p>}</article>)}</div>:<Empty title="No execution jobs" message="Submit an approved workload to track its state and output here."/>;}
function EditorPanel({type,recordKey,setRecordKey,value,setValue,busy,onClose,onSubmit}:{type:AzureServiceType;recordKey:string;setRecordKey:(value:string)=>void;value:string;setValue:(value:string)=>void;busy:boolean;onClose:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void}){
  const database=type==="database",monitoring=type==="monitoring";
  return <aside className="service-editor-panel"><header><div><span>{database?"JSON RECORD":monitoring?"TELEMETRY EVENT":"MANAGED JOB"}</span><h3>{database?(recordKey||"New record"):monitoring?"Create event":"Submit workload"}</h3></div><button onClick={onClose}><Icon name="close"/></button></header><form onSubmit={onSubmit}>{!monitoring&&<label><span>{database?"Record key":"Operation"}</span><input value={recordKey} onChange={event=>setRecordKey(event.target.value)} required placeholder={database?"student-001":"run"}/></label>}<label className="grow"><span>{database?"JSON value":monitoring?"Event payload":"Job input"}</span><textarea value={value} onChange={event=>setValue(event.target.value)} spellCheck={false}/></label><div className="service-editor-help"><strong>Validated JSON</strong><p>Content is isolated to this entitlement and remains behind the Academy gateway.</p></div><footer><button type="button" onClick={onClose}>Cancel</button><button disabled={busy}>{busy?"Saving…":database?"Save record":monitoring?"Send event":"Submit job"}</button></footer></form></aside>;
}
function PreviewPanel({preview,onClose}:{preview:{name:string;url:string;type:string;text?:string};onClose:()=>void}){
  return <aside className="service-preview-panel"><header><div><span>OBJECT PREVIEW</span><h3>{preview.name}</h3><small>{preview.type}</small></div><button onClick={onClose}><Icon name="close"/></button></header><div>{preview.type.startsWith("image/")?<img src={preview.url} alt={preview.name}/>:preview.type==="application/pdf"?<iframe src={preview.url} title={preview.name}/>:preview.text!==undefined?<pre>{preview.text}</pre>:<Empty title="Preview unavailable" message="Download this object to open it with a compatible application."/>}</div></aside>;
}
