
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

const Navbar = () => (
  <nav className="bg-blue-600 text-white p-4 shadow-lg flex justify-between items-center sticky top-0 z-50">
    <div className="flex items-center gap-3">
      <div className="bg-white p-1.5 rounded-xl shadow-inner">
        <svg className="w-8 h-8 text-blue-600" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" />
          <path d="M12 15.5l-4.5 2 4.5-10 4.5 10z" opacity=".3" />
          <path d="M12 11l-2 4.5h4z" />
        </svg>
      </div>
      <div>
        <h1 className="text-xl font-bold tracking-tight leading-none">ระบบตอดสวบ</h1>
        <span className="text-[10px] uppercase tracking-widest opacity-70 font-bold">Smart OMR AI Core</span>
      </div>
    </div>
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v3.0 Stable</div>
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
  const [apiKeyInfo, setApiKeyInfo] = useState<{ found: boolean; prefix: string; source: string }>({ 
    found: false, prefix: 'None', source: 'None' 
  });
  const [manualKey, setManualKey] = useState(localStorage.getItem('manual_api_key') || '');

  const checkKeyStatus = async () => {
    let rawKey = "";
    let source = "Not Detected";
    try {
      const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
      const windowKey = (window as any).API_KEY || "";
      const storedKey = localStorage.getItem('manual_api_key') || "";
      if (envKey && envKey !== "undefined") { rawKey = envKey; source = "System Env"; } 
      else if (windowKey) { rawKey = windowKey; source = "Global"; }
      else if (storedKey) { rawKey = storedKey; source = "Manual (Saved)"; }
      if (!rawKey && (window as any).aistudio?.hasSelectedApiKey) {
        if (await (window as any).aistudio.hasSelectedApiKey()) { source = "AI Studio"; rawKey = "CONNECTED"; }
      }
    } catch (e) {}
    const exists = rawKey.length > 5;
    setApiKeyInfo({ found: exists, prefix: exists ? 'Active' : 'None', source });
  };

  useEffect(() => {
    checkKeyStatus();
    const timer = setInterval(checkKeyStatus, 3000);
    return () => clearInterval(timer);
  }, []);

  const resizeImage = (file: File, maxDim: number = 1600): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxDim) { height *= maxDim / width; width = maxDim; }
          } else {
            if (height > maxDim) { width *= maxDim / height; height = maxDim; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
      };
    });
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const base64 = await resizeImage(file, 1600);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      
      if (data.error) { 
        setErrorMessage(data.error); 
        return; 
      }

      const detectedCount = data.answers.filter(a => a !== null).length;
      if (detectedCount === 0) {
        setErrorMessage("ไม่พบข้อมูลเฉลย กรุณาตรวจสอบว่าทำเครื่องหมายในกระดาษชัดเจนและสว่างเพียงพอ");
        return;
      }

      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
      setIsKeyProcessed(true);
    } catch (err) { 
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผลใบเฉลย"); 
    } finally { 
      setIsLoading(false); 
    }
  };

  const processStudentImages = async (files: FileList) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    setProcessingProgress({ current: 0, total: files.length });
    const newResults: StudentResult[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        setProcessingProgress({ current: i + 1, total: files.length });
        const base64 = await resizeImage(files[i], 1600); // เพิ่มความละเอียดเป็น 1600 เพื่อความแม่นยำ
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false);
        
        if (data.error) { 
          setErrorMessage(`แผ่นที่ ${i+1}: ${data.error}`); 
          continue; 
        }
        
        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));
        
        newResults.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore: answers.filter(a => a.isCorrect).length,
          hasError: data.answers.some(a => a === null),
        });
      }
      if (newResults.length > 0) {
        const updated = { ...activeSubject, results: [...activeSubject.results, ...newResults] };
        setActiveSubject(updated);
        setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
        setCurrentStep(AppStep.VIEW_RESULTS);
      }
    } catch (err) { 
      setErrorMessage("เกิดข้อผิดพลาดในการตรวจแผ่นคำตอบ"); 
    } finally { 
      setIsLoading(false); 
      setProcessingProgress({ current: 0, total: 0 }); 
    }
  };

  const handleCreateSubject = (name: string, count: number) => {
    const newSub: Subject = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
    setSubjects([...subjects, newSub]);
    setActiveSubject(newSub);
    setIsKeyProcessed(false);
    setCurrentStep(AppStep.CALIBRATE_KEY);
  };

  const deleteSubject = (id: string) => {
    if (confirm('ยืนยันการลบรายวิชา?')) {
      const updated = subjects.filter(s => s.id !== id);
      setSubjects(updated);
      if (activeSubject?.id === id) { setActiveSubject(null); setCurrentStep(AppStep.SUBJECT_LIST); }
    }
  };

  return (
    <div className="min-h-screen pb-20 bg-[#f8fafc]">
      <Navbar />
      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {!apiKeyInfo.found && currentStep !== AppStep.SUBJECT_LIST && (
          <div className="mb-8 bg-white border-2 border-amber-100 rounded-[2rem] p-8 shadow-sm">
            <h2 className="text-xl font-black text-amber-600 mb-4 flex items-center gap-2">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
              เชื่อมต่อ API Key (สำหรับ AI)
            </h2>
            <div className="flex gap-2 mb-4">
              <input type="password" placeholder="วางรหัส AIza..." value={manualKey} onChange={(e) => setManualKey(e.target.value)} className="flex-1 px-4 py-3 rounded-xl border border-gray-200 text-xs font-mono" />
              <button onClick={() => { localStorage.setItem('manual_api_key', manualKey.trim()); checkKeyStatus(); alert("บันทึกแล้ว"); }} className="bg-blue-600 text-white px-6 rounded-xl font-black">บันทึก</button>
            </div>
            <button onClick={() => (window as any).aistudio?.openSelectKey()} className="w-full border-2 border-blue-600 text-blue-600 py-3 rounded-xl font-black text-sm">หรือเลือกจากบัญชี Google</button>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex justify-between items-center shadow-sm">
            <p className="text-red-700 text-sm font-bold">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 font-bold px-2">ปิด</button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-blue-400 mb-4"></div>
            <p className="text-xl font-black animate-pulse">
              {currentStep === AppStep.CALIBRATE_KEY ? "กำลังวิเคราะห์เฉลย..." : "กำลังตรวจแผ่นคำตอบ..."}
            </p>
            {processingProgress.total > 0 && <p className="mt-2 text-blue-200">แผ่นที่ {processingProgress.current} จาก {processingProgress.total}</p>}
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">รายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition hover:scale-105 active:scale-95">+ วิชาใหม่</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subjects.length === 0 ? (
                <div className="col-span-full py-20 text-center text-gray-300 font-bold border-4 border-dashed border-gray-100 rounded-[3rem]">
                  ยังไม่มีวิชาที่คุณสร้างไว้
                </div>
              ) : subjects.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition">
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-black">{s.name}</h3>
                    <button onClick={() => deleteSubject(s.id)} className="text-red-200 hover:text-red-400 transition">ลบ</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setActiveSubject(s); setIsKeyProcessed(false); setCurrentStep(AppStep.VIEW_RESULTS); }} className="flex-1 bg-gray-50 py-2.5 rounded-xl font-bold text-gray-600 transition hover:bg-gray-100">ผลลัพธ์</button>
                    <button onClick={() => { setActiveSubject(s); setIsKeyProcessed(false); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="flex-1 bg-blue-600 py-2.5 rounded-xl font-bold text-white transition hover:bg-blue-700 shadow-md">ตรวจ</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-8 rounded-[2rem] shadow-xl max-w-sm mx-auto border border-gray-50">
            <h2 className="text-xl font-black mb-6 text-center">สร้างรายวิชาใหม่</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleCreateSubject(d.get('name') as string, parseInt(d.get('count') as string));
            }} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-2">ชื่อวิชา</label>
                <input required name="name" placeholder="เช่น วิทยาศาสตร์ ป.6" className="w-full px-4 py-3 rounded-xl bg-gray-50 outline-none border border-transparent focus:border-blue-500 focus:bg-white transition" />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black text-gray-400 uppercase ml-2">จำนวนข้อสอบ</label>
                <input required name="count" type="number" min="1" max="100" placeholder="สูงสุด 100 ข้อ" className="w-full px-4 py-3 rounded-xl bg-gray-50 outline-none border border-transparent focus:border-blue-500 focus:bg-white transition" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black shadow-lg hover:bg-blue-700 transition active:scale-95">ถัดไป: อัปโหลดเฉลย</button>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-6">
            {!isKeyProcessed ? (
              <div className="text-center space-y-6">
                <h2 className="text-2xl font-black">อัปโหลดใบเฉลย</h2>
                <p className="text-gray-400 -mt-4">ระบบรองรับรอย กากบาท (X) ขีดถูก (✓) หรือรอยฝน</p>
                <div className="relative h-64 bg-white border-4 border-dashed border-blue-50 rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer shadow-sm hover:border-blue-200 transition">
                  <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processKeyImage(e.target.files[0])} />
                  <div className="bg-blue-50 p-4 rounded-full mb-2 group-hover:bg-blue-100 transition">
                    <svg className="w-12 h-12 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </div>
                  <p className="text-blue-600 font-black">แตะเพื่อถ่ายรูปใบเฉลย</p>
                </div>
                <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="text-gray-400 font-bold hover:underline">หรือข้ามไปขั้นตอนถัดไป</button>
              </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center">
                  <h2 className="text-2xl font-black text-green-600">วิเคราะห์เฉลยเรียบร้อย!</h2>
                  <div className="flex justify-center gap-4 mt-2">
                    <div className="bg-blue-50 px-4 py-1 rounded-full text-blue-600 text-xs font-black uppercase">
                      ทั้งหมด: {activeSubject.totalQuestions} ข้อ
                    </div>
                    <div className="bg-green-50 px-4 py-1 rounded-full text-green-600 text-xs font-black uppercase">
                      ตรวจพบ: {activeSubject.answerKey.filter(a => a !== null).length} ข้อ
                    </div>
                  </div>
                </div>
                
                <div className="bg-white p-6 rounded-[2.5rem] shadow-xl border border-gray-100 overflow-hidden">
                   <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-3 max-h-96 overflow-y-auto p-2 scrollbar-hide">
                      {activeSubject.answerKey.map((ans, idx) => (
                        <div key={idx} className="flex items-center justify-between bg-gray-50 px-3 py-2.5 rounded-xl border border-gray-100 group hover:border-blue-200 transition">
                          <span className="text-[10px] font-black text-gray-400 uppercase">ข้อ {idx + 1}</span>
                          <span className={`text-lg font-black ${ans ? 'text-blue-600' : 'text-red-400 italic text-xs'}`}>
                            {ans || 'ว่าง'}
                          </span>
                        </div>
                      ))}
                   </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition active:scale-95 text-lg">
                    ยืนยัน และเริ่มตรวจแผ่นคำตอบ
                  </button>
                  <button onClick={() => setIsKeyProcessed(false)} className="w-full text-gray-400 font-bold py-2 hover:text-gray-600 transition">
                    สแกนใหม่ (หากเฉลยไม่ถูกต้อง)
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="text-center space-y-10">
             <div className="space-y-2">
               <h2 className="text-2xl font-black">ตรวจแผ่นงาน: {activeSubject.name}</h2>
               <p className="text-xs text-gray-400 bg-blue-50 inline-block px-3 py-1 rounded-full font-bold">โหมดตรวจอัตโนมัติ ({activeSubject.totalQuestions} ข้อ)</p>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative bg-blue-600 text-white rounded-[2.5rem] h-56 flex flex-col items-center justify-center cursor-pointer shadow-lg hover:bg-blue-700 transition active:scale-95 group">
                   <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <div className="bg-white/20 p-4 rounded-full mb-2 group-hover:scale-110 transition duration-300">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                   </div>
                   <span className="text-lg font-black">เปิดกล้องสแกน</span>
                </div>
                <div className="relative bg-white border-2 border-gray-100 rounded-[2.5rem] h-56 flex flex-col items-center justify-center cursor-pointer shadow-sm hover:border-blue-100 transition active:scale-95 group">
                   <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <div className="bg-gray-50 p-4 rounded-full mb-2 group-hover:bg-blue-50 transition duration-300">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                   </div>
                   <span className="text-lg font-black text-gray-500">เลือกจากอัลบั้ม</span>
                </div>
             </div>
             <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold hover:underline">ดูสรุปที่ตรวจแล้ว ({activeSubject.results.length} คน)</button>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-black">{activeSubject.name}</h2>
                <p className="text-gray-400 font-bold text-sm">ตรวจแล้ว {activeSubject.results.length} คน</p>
              </div>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-gray-100 px-4 py-2 rounded-xl font-black text-gray-600 transition hover:bg-gray-200">กลับ</button>
            </div>
            <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-gray-50">
                    <tr className="text-[10px] font-black text-gray-400 uppercase border-b">
                      <th className="px-6 py-4">เลขที่</th>
                      <th className="px-6 py-4">ชื่อ</th>
                      <th className="px-6 py-4 text-center">คะแนน</th>
                      <th className="px-6 py-4">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {activeSubject.results.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-6 py-10 text-center text-gray-300 font-bold italic">ยังไม่มีการตรวจแผ่นคำตอบ</td>
                      </tr>
                    ) : activeSubject.results.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 transition group">
                        <td className="px-6 py-4 font-black text-gray-800">{r.studentNumber || '-'}</td>
                        <td className="px-6 py-4 font-medium text-gray-500 group-hover:text-gray-800">{r.studentName || 'ไม่ระบุ'}</td>
                        <td className="px-6 py-4 text-center">
                          <span className="font-black text-blue-600 text-lg">{r.totalScore}</span>
                          <span className="text-gray-300 ml-1 font-bold text-xs">/{activeSubject.totalQuestions}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black ${r.hasError ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                            {r.hasError ? '⚠️ ตรวจไม่ครบ' : '✅ สมบูรณ์'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg transition hover:bg-blue-700 active:scale-95 text-lg">ตรวจเพิ่ม</button>
              <button onClick={() => window.print()} className="bg-white text-gray-500 px-6 py-4 rounded-2xl font-black border border-gray-100 transition hover:bg-gray-50">พิมพ์</button>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md p-4 border-t border-gray-100 flex justify-between items-center px-8 z-40 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col">
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest leading-none">TODSUAB OMR AI</span>
          <span className="text-[8px] text-gray-300 font-bold mt-1">SMART GRADING SYSTEM</span>
        </div>
        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black flex items-center gap-2 ${apiKeyInfo.found ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
           <span className={`w-1.5 h-1.5 rounded-full ${apiKeyInfo.found ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-red-500 animate-pulse'}`}></span>
           {apiKeyInfo.found ? `AI ACTIVE (${apiKeyInfo.source})` : 'AI OFFLINE'}
        </div>
      </footer>
    </div>
  );
};

export default App;
