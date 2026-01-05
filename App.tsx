
import React, { useState, useEffect } from 'react';
import { Subject, AppStep, Choice, StudentResult, QuestionResult } from './types';
import { analyzeAnswerSheet } from './services/geminiService';

// UI Components
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
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v2.3 (Final Key Patch)</div>
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

  // ฟังก์ชันเช็ค Key แบบละเอียด
  const checkKeyStatus = async () => {
    let rawKey = "";
    let source = "Not Found";

    try {
      // 1. เช็คจาก process.env (Vercel Build-time)
      if (typeof process !== 'undefined' && process.env?.API_KEY) {
        rawKey = process.env.API_KEY;
        source = "Vercel / System Env";
      } 
      // 2. เช็คจาก window global
      else if ((window as any).API_KEY) {
        rawKey = (window as any).API_KEY;
        source = "Global Variable";
      }
      
      // 3. เช็คจาก AI Studio Platform (ถ้ามี)
      if (!rawKey && (window as any).aistudio?.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (hasKey) {
          source = "AI Studio Managed";
          rawKey = "MANAGED_BY_PLATFORM";
        }
      }
    } catch (e) {
      console.warn("Key Check Warning:", e);
    }

    const keyStr = rawKey.toString().trim().replace(/^['"]|['"]$/g, '');
    const isFound = keyStr.length > 5 && keyStr !== "undefined" && keyStr !== "null";

    setApiKeyInfo({
      found: isFound,
      prefix: isFound && keyStr !== "MANAGED_BY_PLATFORM" ? `${keyStr.substring(0, 10)}...` : (isFound ? 'Platform Key' : 'None'),
      source
    });
  };

  useEffect(() => {
    checkKeyStatus();
  }, [currentStep, errorMessage]);

  // ฟังก์ชันเปิดหน้าจอเลือก Key
  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio?.openSelectKey) {
      try {
        await (window as any).aistudio.openSelectKey();
        // หลังจากเลือกเสร็จ ให้ถือว่าเชื่อมต่อแล้ว (ตามกฎ Race Condition)
        setErrorMessage(null);
        await checkKeyStatus();
      } catch (e) {
        setErrorMessage("ไม่สามารถเปิดหน้าต่างเลือก API Key ได้");
      }
    } else {
      setErrorMessage("เบราว์เซอร์นี้ไม่รองรับการเลือก Key อัตโนมัติ กรุณาตรวจสอบ Environment Variables ใน Vercel");
    }
  };

  // Persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem('omr_subjects');
      if (saved) setSubjects(JSON.parse(saved));
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    localStorage.setItem('omr_subjects', JSON.stringify(subjects));
  }, [subjects]);

  const handleCreateSubject = (name: string, count: number) => {
    const newSubject: Subject = {
      id: Date.now().toString(),
      name,
      totalQuestions: count,
      answerKey: new Array(count).fill(null),
      results: [],
      createdAt: Date.now()
    };
    setSubjects([...subjects, newSubject]);
    setActiveSubject(newSubject);
    setCurrentStep(AppStep.CALIBRATE_KEY);
  };

  const deleteSubject = (id: string) => {
    if (window.confirm('ยืนยันการลบรายวิชานี้?')) {
      const updated = subjects.filter(s => s.id !== id);
      setSubjects(updated);
      if (activeSubject?.id === id) {
        setActiveSubject(null);
        setCurrentStep(AppStep.SUBJECT_LIST);
      }
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  const processKeyImage = async (file: File) => {
    if (!activeSubject) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      if (data.error) {
        setErrorMessage(data.error);
        return;
      }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผล");
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
        const base64 = await fileToBase64(files[i]);
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
        const totalScore = answers.filter(a => a.isCorrect).length;
        newResults.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore,
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

  return (
    <div className="min-h-screen pb-20 bg-[#f8fafc]">
      <Navbar />

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {/* TROUBLESHOOTING UI */}
        {!apiKeyInfo.found && currentStep !== AppStep.SUBJECT_LIST && (
          <div className="mb-8 bg-white border-2 border-blue-100 rounded-[2rem] p-8 shadow-sm animate-fadeIn">
            <div className="flex items-center gap-4 mb-4 text-blue-600">
              <div className="bg-blue-50 p-3 rounded-2xl">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              </div>
              <h2 className="text-2xl font-black">AI พร้อมใช้งาน แต่ต้องการ API Key</h2>
            </div>
            
            <p className="text-gray-600 mb-6 leading-relaxed">
              ดูเหมือนว่าแอปไม่สามารถดึงรหัส <code className="bg-gray-100 px-1 rounded">API_KEY</code> จากระบบได้ (อาจเกิดจากการจำกัดของเบราว์เซอร์) โปรดกดปุ่มด้านล่างเพื่อเชื่อมต่อผ่านแพลตฟอร์มโดยตรง:
            </p>

            <div className="flex flex-col gap-4">
              <button 
                onClick={handleOpenKeySelector}
                className="bg-blue-600 text-white px-8 py-5 rounded-[1.5rem] font-black shadow-xl shadow-blue-200 hover:bg-blue-700 hover:scale-[1.02] transition active:scale-95 flex items-center justify-center gap-3 animate-pulse"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/></svg>
                เชื่อมต่อ API Key ผ่านแพลตฟอร์ม
              </button>
              
              <div className="text-[10px] text-gray-400 font-mono text-center space-y-1">
                <div>Source: {apiKeyInfo.source}</div>
                <div>Status: Offline (No valid key detected)</div>
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-center justify-between">
            <p className="text-red-700 text-sm font-bold">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 font-bold">ปิด</button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-400 mb-4"></div>
            <p className="text-xl font-bold">AI กำลังทำงาน...</p>
          </div>
        )}

        {/* STEP VIEWS */}
        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">รายวิชาทั้งหมด</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg">+ สร้างวิชาใหม่</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-20 text-center text-gray-400">ยังไม่มีรายวิชา</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100">
                    <div className="flex justify-between">
                      <h3 className="text-xl font-black">{s.name}</h3>
                      <button onClick={() => deleteSubject(s.id)} className="text-red-300">ลบ</button>
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="flex-1 bg-gray-100 py-2 rounded-xl font-bold">ผลลัพธ์</button>
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="flex-1 bg-blue-600 py-2 rounded-xl font-bold text-white">ตรวจ</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-10 rounded-[2.5rem] shadow-xl max-w-md mx-auto">
            <h2 className="text-2xl font-black mb-6">ตั้งค่าวิชาใหม่</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleCreateSubject(d.get('name') as string, parseInt(d.get('count') as string));
            }} className="space-y-4">
              <input required name="name" placeholder="ชื่อวิชา" className="w-full px-5 py-4 rounded-2xl border border-gray-100 outline-none focus:border-blue-500" />
              <input required name="count" type="number" placeholder="จำนวนข้อ (1-100)" className="w-full px-5 py-4 rounded-2xl border border-gray-100 outline-none focus:border-blue-500" />
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg">ยืนยัน</button>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-8 text-center">
            <h2 className="text-3xl font-black">อัปโหลดเฉลย</h2>
            <div className="relative group overflow-hidden rounded-[3rem] h-48 shadow-xl bg-white border-4 border-dashed border-blue-50 flex items-center justify-center cursor-pointer">
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processKeyImage(e.target.files[0])} />
              <div className="text-blue-600 font-bold text-lg">คลิกเพื่ออัปโหลด "แผ่นเฉลย"</div>
            </div>
            <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black">ต่อไปยังการตรวจนักเรียน</button>
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="space-y-10 text-center">
             <h2 className="text-2xl font-black">ตรวจแผ่นคำตอบ: {activeSubject.name}</h2>
             <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="relative bg-blue-600 text-white rounded-[2.5rem] h-64 flex flex-col items-center justify-center cursor-pointer shadow-xl">
                   <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <span className="text-xl font-bold">เปิดกล้องสแกน</span>
                </div>
                <div className="relative bg-white border-4 border-dashed border-gray-100 rounded-[2.5rem] h-64 flex flex-col items-center justify-center cursor-pointer shadow-md">
                   <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 z-10" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <span className="text-xl font-bold text-gray-400">เลือกไฟล์จากเครื่อง</span>
                </div>
             </div>
             <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold underline">ข้ามไปดูผลลัพธ์</button>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-3xl font-black text-gray-800">{activeSubject.name}</h2>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-gray-100 px-6 py-2 rounded-xl font-bold">กลับ</button>
            </div>
            <div className="bg-white rounded-[2rem] shadow-lg border border-gray-50 overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-gray-50">
                  <tr className="text-xs font-black text-gray-400 uppercase border-b">
                    <th className="px-6 py-4">เลขที่</th>
                    <th className="px-6 py-4">ชื่อ</th>
                    <th className="px-6 py-4 text-center">คะแนน</th>
                    <th className="px-6 py-4">สถานะ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {activeSubject.results.map(r => (
                    <tr key={r.id}>
                      <td className="px-6 py-4 font-black">{r.studentNumber || '-'}</td>
                      <td className="px-6 py-4">{r.studentName || 'ไม่ระบุ'}</td>
                      <td className="px-6 py-4 text-center font-black text-blue-600">{r.totalScore} / {activeSubject.totalQuestions}</td>
                      <td className="px-6 py-4">{r.hasError ? '⚠️ ข้อมูลไม่ครบ' : '✅ ปกติ'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 inset-x-0 bg-white/80 backdrop-blur-md p-4 border-t border-gray-100 flex justify-between items-center px-10">
        <span className="text-[10px] font-black text-gray-300 uppercase">TODSUAB SMART AI</span>
        <div className={`px-4 py-1 rounded-full text-[10px] font-bold flex items-center gap-2 ${apiKeyInfo.found ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
           <span className={`w-1.5 h-1.5 rounded-full ${apiKeyInfo.found ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
           {apiKeyInfo.found ? `AI READY (${apiKeyInfo.prefix})` : 'AI OFFLINE (Tap Connect)'}
        </div>
      </footer>
    </div>
  );
};

export default App;
