
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
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v2.6 (Performance Patch)</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
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

  // ฟังก์ชันย่อขนาดภาพเพื่อความเร็วสูงสุด
  const resizeImage = (file: File, maxDim: number = 1280): Promise<string> => {
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
          resolve(canvas.toDataURL('image/jpeg', 0.8)); // ใช้ JPEG คุณภาพ 0.8 เพื่อลดขนาดไฟล์
        };
      };
    });
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const base64 = await resizeImage(file); // ย่อขนาดก่อนส่ง
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      if (data.error) { setErrorMessage(data.error); return; }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
    } catch (err) { setErrorMessage("เกิดข้อผิดพลาดในการประมวลผล"); } 
    finally { setIsLoading(false); }
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
        const base64 = await resizeImage(files[i]); // ย่อขนาดทุกใบก่อนส่ง
        const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, false);
        if (data.error) { setErrorMessage(`แผ่นที่ ${i+1}: ${data.error}`); continue; }
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
    } catch (err) { setErrorMessage("เกิดข้อผิดพลาด"); } 
    finally { setIsLoading(false); setProcessingProgress({ current: 0, total: 0 }); }
  };

  const handleCreateSubject = (name: string, count: number) => {
    const newSub: Subject = { id: Date.now().toString(), name, totalQuestions: count, answerKey: new Array(count).fill(null), results: [], createdAt: Date.now() };
    setSubjects([...subjects, newSub]);
    setActiveSubject(newSub);
    setCurrentStep(AppStep.CALIBRATE_KEY);
  };

  const deleteSubject = (id: string) => {
    if (confirm('ยืนยันการลบ?')) {
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
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex justify-between items-center">
            <p className="text-red-700 text-sm font-bold">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 font-bold">ปิด</button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white p-6">
            <div className="animate-spin rounded-full h-12 w-12 border-t-4 border-blue-400 mb-4"></div>
            <p className="text-xl font-black animate-pulse">AI กำลังวิเคราะห์ภาพที่ย่อแล้ว...</p>
            {processingProgress.total > 0 && <p className="mt-2 text-blue-200">แผ่นที่ {processingProgress.current} จาก {processingProgress.total}</p>}
          </div>
        )}

        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">รายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg">+ วิชาใหม่</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {subjects.map(s => (
                <div key={s.id} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-md transition">
                  <div className="flex justify-between mb-4">
                    <h3 className="text-lg font-black">{s.name}</h3>
                    <button onClick={() => deleteSubject(s.id)} className="text-red-200">ลบ</button>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="flex-1 bg-gray-50 py-2.5 rounded-xl font-bold text-gray-600">ผลลัพธ์</button>
                    <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="flex-1 bg-blue-600 py-2.5 rounded-xl font-bold text-white">ตรวจข้อสอบ</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-8 rounded-[2rem] shadow-xl max-w-sm mx-auto">
            <h2 className="text-xl font-black mb-6">สร้างรายวิชา</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleCreateSubject(d.get('name') as string, parseInt(d.get('count') as string));
            }} className="space-y-4">
              <input required name="name" placeholder="ชื่อวิชา" className="w-full px-4 py-3 rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" />
              <input required name="count" type="number" placeholder="จำนวนข้อ (1-100)" className="w-full px-4 py-3 rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500" />
              <button type="submit" className="w-full bg-blue-600 text-white py-3.5 rounded-xl font-black shadow-lg">ยืนยัน</button>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="text-center space-y-6">
            <h2 className="text-2xl font-black">อัปโหลดเฉลย</h2>
            <div className="relative h-64 bg-white border-4 border-dashed border-blue-50 rounded-[2.5rem] flex flex-col items-center justify-center cursor-pointer shadow-sm">
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processKeyImage(e.target.files[0])} />
              <svg className="w-12 h-12 text-blue-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              <p className="text-blue-600 font-black">แตะเพื่อถ่ายภาพเฉลย</p>
            </div>
            <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="text-gray-400 font-bold hover:underline">หรือข้ามไปขั้นตอนถัดไป</button>
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="text-center space-y-10">
             <div className="space-y-2">
               <h2 className="text-2xl font-black">ตรวจคำตอบ: {activeSubject.name}</h2>
             </div>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="relative bg-blue-600 text-white rounded-[2.5rem] h-56 flex flex-col items-center justify-center cursor-pointer shadow-lg">
                   <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <span className="text-lg font-black">เปิดกล้องสแกน</span>
                </div>
                <div className="relative bg-white border-2 border-gray-100 rounded-[2.5rem] h-56 flex flex-col items-center justify-center cursor-pointer shadow-sm">
                   <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <span className="text-lg font-black text-gray-500">เลือกภาพจากอัลบั้ม</span>
                </div>
             </div>
             <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold">ดูสรุปคะแนน ({activeSubject.results.length} คน)</button>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black">{activeSubject.name} ({activeSubject.results.length} คน)</h2>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-gray-100 px-4 py-2 rounded-xl font-black">กลับ</button>
            </div>
            <div className="bg-white rounded-[2rem] shadow-lg border border-gray-50 overflow-hidden overflow-x-auto">
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
                  {activeSubject.results.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition">
                      <td className="px-6 py-4 font-black">{r.studentNumber || '-'}</td>
                      <td className="px-6 py-4 font-medium text-gray-600">{r.studentName || 'ไม่ระบุ'}</td>
                      <td className="px-6 py-4 text-center font-black text-blue-600">{r.totalScore}/{activeSubject.totalQuestions}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-black ${r.hasError ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                          {r.hasError ? '⚠️ ไม่สมบูรณ์' : '✅ สมบูรณ์'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-4">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ตรวจเพิ่ม</button>
              <button onClick={() => window.print()} className="bg-white text-gray-500 px-6 py-4 rounded-2xl font-black border border-gray-100">พิมพ์</button>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md p-4 border-t border-gray-100 flex justify-between items-center px-10 z-40">
        <span className="text-[10px] font-black text-gray-300 uppercase tracking-widest">TODSUAB OMR AI</span>
        <div className={`px-4 py-1.5 rounded-full text-[10px] font-black flex items-center gap-2 ${apiKeyInfo.found ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
           <span className={`w-1.5 h-1.5 rounded-full ${apiKeyInfo.found ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`}></span>
           {apiKeyInfo.found ? `AI ACTIVE` : 'AI OFFLINE'}
        </div>
      </footer>
    </div>
  );
};

export default App;
