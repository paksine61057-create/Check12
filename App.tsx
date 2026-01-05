
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
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v2.4</div>
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

  const checkKeyStatus = async () => {
    let rawKey = "";
    let source = "Not Detected";

    try {
      // 1. ตรวจสอบ process.env แบบปลอดภัย
      const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
      
      if (envKey && envKey !== "undefined") {
        rawKey = envKey;
        source = "System Environment";
      } 
      else if ((window as any).API_KEY) {
        rawKey = (window as any).API_KEY;
        source = "Direct Window Variable";
      }
      
      // 2. ตรวจสอบผ่าน AI Studio (ถ้ามี)
      if (!rawKey && (window as any).aistudio?.hasSelectedApiKey) {
        const hasKey = await (window as any).aistudio.hasSelectedApiKey();
        if (hasKey) {
          source = "AI Studio Managed";
          rawKey = "CONNECTED_VIA_PLATFORM";
        }
      }
    } catch (e) {
      console.warn("Key check failed", e);
    }

    const keyClean = rawKey.toString().trim().replace(/^['"]|['"]$/g, '');
    const exists = keyClean.length > 5 && keyClean !== "undefined" && keyClean !== "null";

    setApiKeyInfo({
      found: exists,
      prefix: exists && keyClean !== "CONNECTED_VIA_PLATFORM" ? `${keyClean.substring(0, 10)}...` : (exists ? 'Connected' : 'None'),
      source
    });
  };

  useEffect(() => {
    checkKeyStatus();
    // ตรวจสอบทุกๆ 5 วินาทีเผื่อมีการเปลี่ยนแปลงจากภายนอก
    const timer = setInterval(checkKeyStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  const handleOpenKeySelector = async () => {
    if ((window as any).aistudio?.openSelectKey) {
      try {
        await (window as any).aistudio.openSelectKey();
        setErrorMessage(null);
        // กฎ Race Condition: ให้ถือว่าสำเร็จทันที
        setApiKeyInfo(prev => ({ ...prev, found: true, source: 'User Action' }));
        await checkKeyStatus();
      } catch (e) {
        setErrorMessage("ไม่สามารถเปิดเครื่องมือเลือก Key ได้");
      }
    } else {
      setErrorMessage("ระบบไม่พบเครื่องมือจัดการ Key อัตโนมัติ โปรดตั้งค่าใน Vercel Settings");
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
        if (data.isAuthError) handleOpenKeySelector(); // ถ้าเป็น Auth Error ให้เปิดหน้าเลือก Key ใหม่
        return;
      }
      const updated = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updated);
      setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผลเฉลย");
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
          if (data.isAuthError) { handleOpenKeySelector(); break; }
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
        {/* API KEY SETUP UI - แสดงเฉพาะเมื่อต้องการใช้งานจริงๆ */}
        {!apiKeyInfo.found && currentStep !== AppStep.SUBJECT_LIST && (
          <div className="mb-8 bg-white border-2 border-amber-100 rounded-[2rem] p-8 shadow-sm animate-pulse">
            <div className="flex items-center gap-4 mb-4 text-amber-600">
              <div className="bg-amber-50 p-3 rounded-2xl">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              </div>
              <h2 className="text-2xl font-black">AI กำลังรอการเชื่อมต่อ</h2>
            </div>
            
            <p className="text-gray-600 mb-6 font-medium">
              คุณต้องเชื่อมต่อ API Key เพื่อใช้ความสามารถในการตรวจข้อสอบด้วย AI:
            </p>

            <button 
              onClick={handleOpenKeySelector}
              className="w-full bg-blue-600 text-white px-8 py-5 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition flex items-center justify-center gap-3"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
              กดที่นี่เพื่อเชื่อมต่อ API Key
            </button>
            
            <div className="mt-4 text-[10px] text-center text-gray-400 font-mono">
              Detection: {apiKeyInfo.source}
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mb-6 bg-red-50 border-l-4 border-red-500 p-4 rounded-xl flex items-center justify-between shadow-sm">
            <p className="text-red-700 text-sm font-bold">{errorMessage}</p>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 font-bold hover:text-red-600">ปิด</button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-blue-400 mb-4"></div>
            <p className="text-xl font-bold">AI กำลังวิเคราะห์ข้อมูล...</p>
            {processingProgress.total > 1 && (
              <p className="mt-2 text-blue-200">แผ่นที่ {processingProgress.current} จากทั้งหมด {processingProgress.total} แผ่น</p>
            )}
          </div>
        )}

        {/* STEP VIEWS */}
        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-black text-gray-800">รายวิชา</h2>
              <button onClick={() => setCurrentStep(AppStep.SETUP_SUBJECT)} className="bg-blue-600 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition hover:scale-105 active:scale-95">+ สร้างวิชาใหม่</button>
            </div>
            {subjects.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2.5rem] p-24 text-center text-gray-400 font-medium">
                เริ่มต้นโดยการสร้างรายวิชาใหม่
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-md transition">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-xl font-black text-gray-800">{s.name}</h3>
                        <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">{s.totalQuestions} ข้อ</p>
                      </div>
                      <button onClick={() => deleteSubject(s.id)} className="text-red-200 hover:text-red-500 transition">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-4v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                    <div className="flex gap-3 mt-auto">
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); }} className="flex-1 bg-gray-50 py-3 rounded-xl font-bold text-gray-600 hover:bg-gray-100 transition">ดูผลคะแนน</button>
                      <button onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); }} className="flex-1 bg-blue-600 py-3 rounded-xl font-bold text-white shadow-md hover:bg-blue-700 transition">ตรวจข้อสอบ</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-10 rounded-[2.5rem] shadow-xl max-w-md mx-auto border border-gray-50">
            <h2 className="text-2xl font-black mb-6 text-gray-800">ตั้งค่าวิชาใหม่</h2>
            <form onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              handleCreateSubject(d.get('name') as string, parseInt(d.get('count') as string));
            }} className="space-y-5">
              <div>
                <label className="text-xs font-black text-gray-400 uppercase ml-2 mb-1 block">ชื่อวิชา</label>
                <input required name="name" placeholder="เช่น ภาษาไทย ม.1" className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-none outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
              </div>
              <div>
                <label className="text-xs font-black text-gray-400 uppercase ml-2 mb-1 block">จำนวนข้อสอบ</label>
                <input required name="count" type="number" min="1" max="100" placeholder="1-100 ข้อ" className="w-full px-5 py-4 rounded-2xl bg-gray-50 border-none outline-none focus:ring-2 focus:ring-blue-500 font-medium" />
              </div>
              <button type="submit" className="w-full bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition active:scale-95">สร้างรายวิชา</button>
              <button type="button" onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="w-full py-4 text-gray-400 font-bold text-sm">ยกเลิก</button>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-8 text-center">
            <div className="space-y-2">
              <h2 className="text-3xl font-black text-gray-800">ขั้นตอนที่ 1: อัปโหลดเฉลย</h2>
              <p className="text-gray-400 font-medium">ใช้กล้องถ่ายภาพกระดาษคำตอบที่ "ฝนเฉลย" ไว้</p>
            </div>
            
            <div className="relative group overflow-hidden rounded-[3rem] h-64 shadow-xl bg-white border-4 border-dashed border-blue-100 flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 transition-all">
              <input type="file" accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processKeyImage(e.target.files[0])} />
              <div className="bg-blue-50 p-5 rounded-full mb-4 group-hover:scale-110 transition">
                <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </div>
              <div className="text-blue-600 font-black text-lg">ถ่ายภาพแผ่นเฉลย</div>
              <p className="text-gray-300 text-xs mt-2">หรือคลิกเพื่อเลือกไฟล์รูปภาพ</p>
            </div>
            
            <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="text-gray-400 font-bold hover:text-blue-600 transition">หรือข้ามไปฝนเฉลยด้วยตัวเองภายหลัง</button>
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="space-y-10 text-center">
             <div className="space-y-2">
               <h2 className="text-2xl font-black text-gray-800">ขั้นตอนที่ 2: ตรวจคำตอบ</h2>
               <p className="text-gray-400 font-medium">วิชา: {activeSubject.name} ({activeSubject.totalQuestions} ข้อ)</p>
             </div>

             <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="relative bg-blue-600 text-white rounded-[2.5rem] h-64 flex flex-col items-center justify-center cursor-pointer shadow-xl hover:bg-blue-700 transition group">
                   <input type="file" accept="image/*" capture="environment" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <div className="bg-white/20 p-4 rounded-full mb-3 group-hover:scale-110 transition">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                   </div>
                   <span className="text-xl font-black">เปิดกล้องถ่ายภาพ</span>
                </div>
                <div className="relative bg-white border-2 border-gray-100 rounded-[2.5rem] h-64 flex flex-col items-center justify-center cursor-pointer shadow-sm hover:border-blue-200 transition group">
                   <input type="file" multiple accept="image/*" className="absolute inset-0 opacity-0 z-10 cursor-pointer" onChange={(e) => e.target.files && processStudentImages(e.target.files)} />
                   <div className="bg-gray-50 p-4 rounded-full mb-3 group-hover:scale-110 transition">
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                   </div>
                   <span className="text-xl font-black text-gray-600">อัปโหลดจากคลังภาพ</span>
                </div>
             </div>
             <button onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)} className="text-blue-600 font-bold hover:underline">ดูสรุปคะแนน {activeSubject.results.length} คน</button>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-black text-gray-800">{activeSubject.name}</h2>
                <p className="text-gray-400 font-medium">พบข้อมูลนักเรียน {activeSubject.results.length} คน</p>
              </div>
              <button onClick={() => setCurrentStep(AppStep.SUBJECT_LIST)} className="bg-gray-100 text-gray-600 px-6 py-2 rounded-xl font-black hover:bg-gray-200 transition">กลับ</button>
            </div>

            {activeSubject.results.length === 0 ? (
              <div className="bg-white p-20 rounded-[2.5rem] text-center text-gray-300 font-bold">ยังไม่มีข้อมูลนักเรียน</div>
            ) : (
              <div className="bg-white rounded-[2rem] shadow-lg border border-gray-50 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-gray-50/50">
                      <tr className="text-[10px] font-black text-gray-400 uppercase border-b">
                        <th className="px-6 py-4">เลขที่</th>
                        <th className="px-6 py-4">ชื่อ-นามสกุล</th>
                        <th className="px-6 py-4 text-center">คะแนน</th>
                        <th className="px-6 py-4">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {activeSubject.results.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50/50 transition">
                          <td className="px-6 py-4 font-black text-gray-800">{r.studentNumber || '-'}</td>
                          <td className="px-6 py-4 font-medium text-gray-600">{r.studentName || 'ไม่ระบุชื่อ'}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="font-black text-blue-600 text-lg">{r.totalScore}</span>
                            <span className="text-xs text-gray-300 ml-1">/ {activeSubject.totalQuestions}</span>
                          </td>
                          <td className="px-6 py-4">
                            {r.hasError ? (
                              <span className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">⚠️ ไม่สมบูรณ์</span>
                            ) : (
                              <span className="bg-green-50 text-green-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">✅ ตรวจแล้ว</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            
            <div className="flex gap-4">
              <button onClick={() => setCurrentStep(AppStep.SCAN_STUDENTS)} className="flex-1 bg-blue-600 text-white py-4 rounded-2xl font-black shadow-lg hover:bg-blue-700 transition">เพิ่มแผ่นคำตอบ</button>
              <button onClick={() => window.print()} className="bg-white text-gray-600 px-6 py-4 rounded-2xl font-black border border-gray-100 shadow-sm hover:bg-gray-50 transition">พิมพ์ผลลัพธ์</button>
            </div>
          </section>
        )}
      </main>

      {/* FOOTER STATUS BAR */}
      <footer className="fixed bottom-0 inset-x-0 bg-white/90 backdrop-blur-md p-4 border-t border-gray-100 flex justify-between items-center px-10 z-40">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 text-white p-1 rounded-md">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z"/></svg>
          </div>
          <span className="text-[10px] font-black text-gray-800 uppercase tracking-widest">TODSUAB SMART OMR</span>
        </div>
        
        <div 
          onClick={handleOpenKeySelector}
          className={`px-4 py-1.5 rounded-full text-[10px] font-black flex items-center gap-2 cursor-pointer transition-all active:scale-95 ${apiKeyInfo.found ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600 animate-pulse'}`}
        >
           <span className={`w-1.5 h-1.5 rounded-full ${apiKeyInfo.found ? 'bg-green-500' : 'bg-red-500'}`}></span>
           {apiKeyInfo.found ? `AI READY (${apiKeyInfo.prefix})` : 'API NOT CONNECTED (TAP HERE)'}
        </div>
      </footer>
    </div>
  );
};

export default App;
