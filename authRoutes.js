const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/database');
const { authenticateToken } = require('../middleware/authMiddleware');
const TOKEN_EXPIRY='8h';

function createAuthRoutes(io, emitDoctorLogin){
  const router=express.Router();
  router.post('/login',(req,res)=>{
    const {username,password,expectedRole}=req.body;
    if(!username||!password||!expectedRole)return res.status(400).json({success:false,message:'username, password and expectedRole are required'});
    db.get('SELECT * FROM users WHERE username=?',[username],(err,user)=>{
      if(err)return res.status(500).json({success:false,message:'Server error'});
      const ipAddress=req.ip||req.socket?.remoteAddress||'unknown'; const userAgent=req.headers['user-agent']||'unknown';
      const logAttempt=(status,u)=>db.run(`INSERT INTO login_logs (user_id,username,role,ip_address,user_agent,login_status) VALUES (?,?,?,?,?,?)`,[u?.id||null,username,u?.role||null,ipAddress,userAgent,status]);
      if(!user){logAttempt('failed',null);return res.status(401).json({success:false,message:'Invalid username or password'});}
      bcrypt.compare(password,user.password_hash,(cmpErr,match)=>{
        if(cmpErr)return res.status(500).json({success:false,message:'Server error'});
        if(!match){logAttempt('failed',user);return res.status(401).json({success:false,message:'Invalid username or password'});}
        if(user.role!==expectedRole){logAttempt('denied_role',user);return res.status(403).json({success:false,message:'Access denied for this role'});}
        const issueSession=()=>{
          const safeUser={id:user.id,username:user.username,fullName:user.full_name,role:user.role,doctorId:user.doctor_id,department:user.department};
          const token=jwt.sign(safeUser,process.env.JWT_SECRET,{expiresIn:TOKEN_EXPIRY}); logAttempt('success',user);
          if(user.role==='doctor'&&io&&emitDoctorLogin)emitDoctorLogin(io,{...safeUser,ipAddress,loginTime:new Date().toISOString()});
          res.json({success:true,token,user:safeUser});
        };
        if(user.role==='admin'){
          db.get(`SELECT id,reason FROM account_restrictions WHERE user_id=? AND status='Active' ORDER BY id DESC LIMIT 1`,[user.id],(restrictionErr,restriction)=>{
            if(restrictionErr)return res.status(500).json({success:false,message:'Unable to verify administrator account status'});
            if(restriction){
              logAttempt('restricted',user);
              return res.status(423).json({success:false,terminated:true,message:'Administrator account restricted by WeCare Security and pending Higher Official review.',reason:restriction.reason});
            }
            issueSession();
          });
        }else issueSession();
      });
    });
  });
  router.get('/me',authenticateToken,(req,res)=>{
    db.get('SELECT id,username,full_name,role,doctor_id,department FROM users WHERE id=?',[req.user.id],(err,user)=>{
      if(err)return res.status(500).json({success:false,message:'Server error'}); if(!user)return res.status(404).json({success:false,message:'User not found'});
      res.json({success:true,user:{id:user.id,username:user.username,fullName:user.full_name,role:user.role,doctorId:user.doctor_id,department:user.department}});
    });
  });
  return router;
}
module.exports=createAuthRoutes;
