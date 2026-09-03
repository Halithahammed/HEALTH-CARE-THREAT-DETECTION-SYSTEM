const {generateDataset}=require('../services/datasetService');
const {trainModel}=require('../services/mlService');
const db=require('./database');
(async()=>{try{const d=await generateDataset({reports:1200,days:60});console.log('Dataset generated',d);const m=await trainModel();console.log('Model trained',m.version)}catch(e){console.error(e);process.exitCode=1}finally{setTimeout(()=>db.close(),300)}})();
