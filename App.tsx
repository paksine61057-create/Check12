
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

const Navbar = () => (
  <nav className="bg-blue-600 text-white p-4 shadow-md flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1 rounded-lg">
        <svg className="w-6 h-6 text-blue-600" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" /></svg>
      </div>
      <h1 className="text-lg font-bold">ระบบตอดสวบ</h1>
    </div>
    <div className="text-[10px] bg-blue-700 px-2 py-1 rounded border border-blue-400 font-mono">v3.3 Stable</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isKeyProcessed, setIsKeyProcessed] = useState(false);
  const [apiKeyInfo, setApiKeyInfo] = useState({ found: false, source: 'None' });
  const [manualKey, setManualKey] = useState(localStorage.getItem('manual_api_key') || '');

  const checkKeyStatus = () => {
    const key = (typeof process !== 'undefined' && process.env?.API_KEY) || (window as any).API_KEY || localStorage.getItem('manual_api_key');
    setApiKeyInfo({ found: !!key && key.length > 10, source: key ? 'Active' : 'Missing' });
  };

  useEffect(() => {
    checkKeyStatus();
    const t = setInterval(checkKeyStatus, 3000);
    return () => clearInterval(t);
  }, []);

  const resizeImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 1200; // ปรับลงมาที่ 1200 เพื่อลด Inference Error
          let w = img.width, h = img.height;
          if (w > h) { if (w > maxDim) { h *= maxDim / w; w = maxDim; } }
          else { if (h > maxDim) { w *= maxDim / h; h = maxDim; } }
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
      };
    });
  };

  const toggleChoice = (idx: number) => {
    if (!activeSubject) return;
    const choices: Choice[] = ['ก', 'ข', 'ค', 'ง', null];
    const current = activeSubject.answerKey[idx];
    const nextIdx = (choices.indexOf(current) + 1) % choices.length;
    const newKey = [...activeSubject.answerKey];
    newKey[idx] = choices[nextIdx];
    
    const updated = { ...activeSubject, answerKey: newKey };
    setActiveSubject(updated);
    setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null);
    try {
      const base64 = await resizeImage(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      if (data.error) { setErrorMessage(data.error); return; }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setIsKeyProcessed(true);
    } catch (err) { setErrorMessage("ระบบขัดข้อง กรุณาลองใหม่"); }
    finally { setIsLoading(false); }
  };

  const processStudentImages = async (files: FileList) => {
    if (!activeSubject) return;
    setIsLoading(true); setErrorMessage(null);
    setProcessingProgress({ current: 0, total: files.length });
    const results = [...activeSubject.results];
    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingProgress({ current: i + 1, total: files.length });
        const base64 = await resizeImage(files[i]);
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false);
        if (data.error) continue;
        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));
        results.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore: answers.filter(a => a.isCorrect).length,
          hasError: data.answers.some(a => a === null)
        });
      }
      const updated = { ...activeSubject, results };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
      setCurrentStep(AppStep.VIEW_RESULTS);
    } catch (err) { setErrorMessage("การสแกนล้มเหลว"); }
    finally { setIsLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] pb-20">
      <Navbar />
      <main className="max-w-xl mx-auto p-4 space-y-4">
        
        {/* Error/Notice */}
        {errorMessage && (
          <div className="bg-red-500 text-white p-4 rounded-2xl text-sm font-bold shadow-lg animate-pulse">
            {errorMessage}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-6 text-center">
            <div className="w-16 h-16 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-xl font-black text-blue-900">กำลังตรวจจับตาราง ก ข ค ง...</p>
            {processingProgress.total > 0 && <p className="text-blue-600 font-bold mt-2">กำลังตรวจแผ่นที่ {processingProgress.current} จาก {processingProgress.total}</p>}
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">รายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-5 py-2.5 rounded-2xl font-bold shadow-md hover:bg-blue-700 transition">+ วิชาใหม่</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white p-16 text-center rounded-[2.5rem] border-2 border-dashed border-slate-200 text-slate-400 font-bold">ยังไม่มีข้อมูลวิชา</div>
            ) : (
              subjects.map(s => (
                <div key={s.id} className="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex justify-between items-center">
                  <div>
                    <h3 className="font-bold text-slate-800">{s.name}</h3>
                    <p className="text-xs text-slate-400 font-medium">{s.totalQuestions} ข้อ • ตรวจแล้ว {s.results.length} คน</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl font-bold text-sm">ดูผล</button>
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-sm">ตรวจ</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <div className="bg-white p-8 rounded-[2.5rem] shadow-xl space-y-6">
            <h2 className="text-center text-xl font-black">ข้อมูลวิชาใหม่</h2>
            <form onSubmit={e => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const name = f.get('name') as string;
              const count = parseInt(f.get('count') as string);
              const newSub = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
              setSubjects([...subjects, newSub]); setActiveSubject(newSub); setIsKeyProcessed(false); setCurrentStep(AppStep.CALIBRATE_KEY);
            }} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase px-2">ชื่อวิชา</label>
                <input required name="name" placeholder="ระบุชื่อวิชา" className="w-full p-4 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 border-none font-medium" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-400 uppercase px-2">จำนวนข้อสอบ</label>
                <input required name="count" type="number" placeholder="เช่น 20" className="w-full p-4 bg-slate-50 rounded-2xl outline-none focus:ring-2 ring-blue-500 border-none font-medium" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black text-lg shadow-lg hover:bg-blue-700 transition">ถัดไป: สแกนเฉลย</button>
            </form>
            <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full text-slate-400 font-bold">ยกเลิก</button>
          </div>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <div className="space-y-4">
            {!isKeyProcessed ? (
              <div className="bg-white p-10 rounded-[3rem] border-4 border-dashed border-slate-100 text-center space-y-6">
                <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                </div>
                <div className="space-y-2">
                  <h2 className="font-black text-xl">สแกนใบเฉลย</h2>
                  <p className="text-sm text-slate-400 font-medium leading-relaxed">วางใบเฉลยให้ตรงแนว สว่างๆ <br/>AI จะตรวจจับ 4 ช่อง ก ข ค ง</p>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processKeyImage(e.target.files[0])} />
                    <button className="bg-blue-600 text-white w-full py-4 rounded-2xl font-black shadow-md flex flex-col items-center gap-1">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
                      <span className="text-xs">ถ่ายภาพ</span>
                    </button>
                  </div>
                  <div className="relative">
                    <input type="file" accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processKeyImage(e.target.files[0])} />
                    <button className="bg-white border-2 border-slate-100 text-slate-600 w-full py-4 rounded-2xl font-black flex flex-col items-center gap-1">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                      <span className="text-xs">เลือกรูป</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4">
                <div className="bg-green-50 p-5 rounded-3xl border border-green-100 text-center space-y-1">
                  <h2 className="font-black text-green-700">สแกนเฉลยสำเร็จ!</h2>
                  <p className="text-[10px] text-green-600 font-bold uppercase">💡 หากข้อไหนผิด แตะที่ข้อนั้นเพื่อเปลี่ยนคำตอบ</p>
                </div>
                
                <div className="bg-white rounded-[2.5rem] p-5 shadow-sm border border-slate-50 grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[50vh] overflow-y-auto scrollbar-hide">
                  {activeSubject.answerKey.map((ans, idx) => (
                    <div key={idx} onClick={() => toggleChoice(idx)} className="flex items-center justify-between p-3.5 bg-slate-50 rounded-2xl cursor-pointer hover:bg-blue-50 transition border border-transparent hover:border-blue-200">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">ข้อ {idx + 1}</span>
                      <span className={`font-black text-xl ${ans ? 'text-blue-600' : 'text-red-400'}`}>{ans || '?'}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setIsKeyProcessed(false)} className="flex-1 py-4 text-slate-400 font-bold">ถ่ายใหม่</button>
                  <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-[2] bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ยืนยันเฉลย</button>
                </div>
              </div>
            )}
          </div>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <div className="space-y-8 text-center py-6">
            <div className="space-y-2">
              <h2 className="font-black text-2xl text-slate-800">วิชา: {activeSubject.name}</h2>
              <p className="text-sm text-slate-400 font-medium">พร้อมสแกนแผ่นงานนักเรียน</p>
            </div>
            
            <div className="bg-white p-10 rounded-[3rem] shadow-sm border border-slate-50 flex flex-col items-center gap-6">
               <div className="w-24 h-24 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-xl shadow-blue-200 animate-pulse">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /></svg>
               </div>
               
               <div className="w-full grid grid-cols-1 gap-3">
                  <div className="relative">
                    <input type="file" multiple accept="image/*" capture="environment" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processStudentImages(e.target.files)} />
                    <button className="bg-blue-600 text-white w-full py-4 rounded-2xl font-black text-lg shadow-lg">เปิดกล้องสแกน</button>
                  </div>
                  <div className="relative">
                    <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={e => e.target.files && processStudentImages(e.target.files)} />
                    <button className="bg-slate-100 text-slate-600 w-full py-4 rounded-2xl font-black">เลือกจากคลังภาพ</button>
                  </div>
               </div>
               <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold hover:underline">ข้ามไปดูสรุป</button>
            </div>
          </div>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <div className="space-y-6">
            <div className="flex justify-between items-end">
              <div>
                <h2 className="font-black text-2xl text-slate-800 leading-none">{activeSubject.name}</h2>
                <p className="text-sm text-slate-400 font-bold mt-2 uppercase tracking-widest">Grading Summary</p>
              </div>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-slate-100 p-2 rounded-xl text-slate-400">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
              </button>
            </div>
            
            <div className="space-y-3">
              {activeSubject.results.length === 0 ? (
                <div className="bg-white p-12 text-center rounded-[2.5rem] text-slate-300 font-bold italic">ยังไม่มีประวัติการตรวจ</div>
              ) : activeSubject.results.map(r => (
                <div key={r.id} className="bg-white p-5 rounded-3xl shadow-sm flex justify-between items-center border border-slate-50 group hover:border-blue-200 transition">
                  <div className="flex gap-4 items-center">
                    <div className="bg-blue-50 text-blue-600 w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg">
                      {r.studentNumber || '?'}
                    </div>
                    <div>
                      <h4 className="font-black text-slate-700">{r.studentName || 'ไม่ระบุชื่อ'}</h4>
                      <p className={`text-[10px] font-bold uppercase tracking-tight ${r.hasError ? 'text-amber-500' : 'text-green-500'}`}>
                        {r.hasError ? '⚠️ Incomplete Scan' : '✅ Verified'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-2xl font-black text-blue-600">{r.totalScore}</span>
                    <span className="text-[10px] text-slate-300 ml-1 font-bold">/{activeSubject.totalQuestions}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 sticky bottom-6">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-[2] bg-blue-600 text-white py-4 rounded-2xl font-black shadow-xl shadow-blue-100 hover:scale-[1.02] transition">สแกนเพิ่ม</button>
              <button onClick={() => window.print()} className="flex-1 bg-white text-slate-400 px-6 py-4 rounded-2xl font-black border border-slate-100">พิมพ์</button>
            </div>
          </div>
        )}
      </main>

      {/* Persistent Status Bar */}
      <div className="fixed bottom-0 inset-x-0 p-4 flex justify-center pointer-events-none z-50">
         <div className={`px-5 py-2 rounded-full text-[10px] font-black shadow-2xl pointer-events-auto backdrop-blur-md ${apiKeyInfo.found ? 'bg-green-500/90 text-white' : 'bg-red-500/90 text-white'}`}>
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full ${apiKeyInfo.found ? 'bg-white' : 'bg-white animate-pulse'}`}></div>
              {apiKeyInfo.found ? 'AI CORE: ONLINE' : 'AI CORE: OFFLINE'}
            </div>
         </div>
      </div>
    </div>
  );
};

export default App;
