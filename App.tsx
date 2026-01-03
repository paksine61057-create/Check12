
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
        <span className="text-[10px] uppercase tracking-widest opacity-70 font-bold">Smart OMR Reader</span>
      </div>
    </div>
    <div className="text-sm bg-blue-700/50 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 font-medium">v1.9 (Hybrid)</div>
  </nav>
);

const App: React.FC = () => {
  const [currentStep, setCurrentStep] = useState<AppStep>(AppStep.SUBJECT_LIST);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubject, setActiveSubject] = useState<Subject | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [isApiKeySelected, setIsApiKeySelected] = useState<boolean>(true);

  // ตรวจสอบสถานะ AI (ใช้แสดงสถานะใน Footer เท่านั้น ไม่บังคับใช้)
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
        const has = await window.aistudio.hasSelectedApiKey();
        setIsApiKeySelected(has || !!process.env.API_KEY);
      } else {
        setIsApiKeySelected(!!process.env.API_KEY);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
      try {
        await window.aistudio.openSelectKey();
        setIsApiKeySelected(true);
        setErrorMessage(null);
      } catch (e) {
        console.error("Key Selector Error:", e);
      }
    }
  };

  // Persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem('omr_subjects');
      if (saved) setSubjects(JSON.parse(saved));
    } catch (e) {
      console.error("Failed to load local data", e);
    }
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
    setErrorMessage(null);
  };

  const deleteSubject = (id: string) => {
    if (window.confirm('ยืนยันการลบรายวิชานี้? ข้อมูลทั้งหมดจะหายไป')) {
      const updatedSubjects = subjects.filter(s => s.id !== id);
      setSubjects(updatedSubjects);
      if (activeSubject?.id === id) setActiveSubject(null);
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
    setProcessingProgress({ current: 1, total: 1 });
    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeAnswerSheet(base64, activeSubject.totalQuestions, true);
      
      if (data.error) {
        setErrorMessage(data.error + " (คุณสามารถเลือกเฉลยด้วยตนเองได้ในตารางด้านล่าง)");
        if (data.isAuthError) setIsApiKeySelected(false);
        return;
      }

      const updatedSubject = { ...activeSubject, answerKey: data.answers };
      setActiveSubject(updatedSubject);
      setSubjects(subjects.map(s => s.id === updatedSubject.id ? updatedSubject : s));
    } catch (err) {
      setErrorMessage("ไม่สามารถประมวลผลด้วย AI ได้ในขณะนี้");
    } finally {
      setIsLoading(false);
      setProcessingProgress({ current: 0, total: 0 });
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
          if (data.isAuthError) {
            setErrorMessage(data.error + " กรุณาป้อนข้อมูลด้วยมือในหน้าสรุปผล");
            setIsApiKeySelected(false);
            break;
          }
          continue;
        }

        const answers: QuestionResult[] = data.answers.map((ans, idx) => ({
          questionNo: idx + 1,
          studentAnswer: ans,
          correctAnswer: activeSubject.answerKey[idx],
          isCorrect: ans === activeSubject.answerKey[idx]
        }));

        const totalScore = answers.filter(a => a.isCorrect).length;
        const hasError = data.answers.some(a => a === null || a === 'multiple');

        newResults.push({
          id: Math.random().toString(36).substr(2, 9),
          studentNumber: data.studentId || "",
          studentName: data.studentName || "",
          answers,
          totalScore,
          hasError,
          errorMessage: hasError ? "ตรวจพบข้อที่ไม่ได้ตอบหรือตอบมากกว่าหนึ่ง" : undefined
        });
      }

      if (newResults.length > 0) {
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const combinedResults = [...activeSubject.results, ...newResults];
        const sortedResults = combinedResults.sort((a, b) => 
          collator.compare(a.studentNumber || "999", b.studentNumber || "999")
        );

        const updatedSubject = { ...activeSubject, results: sortedResults };
        setActiveSubject(updatedSubject);
        setSubjects(subjects.map(s => s.id === updatedSubject.id ? updatedSubject : s));
        setCurrentStep(AppStep.VIEW_RESULTS);
      } else if (!errorMessage) {
        setErrorMessage("ไม่สามารถตรวจด้วย AI ได้ กรุณาป้อนข้อมูลด้วยมือ");
      }
    } catch (err) {
      setErrorMessage("เกิดข้อผิดพลาดในการประมวลผลภาพ");
    } finally {
      setIsLoading(false);
      setProcessingProgress({ current: 0, total: 0 });
    }
  };

  const exportToCSV = () => {
    if (!activeSubject) return;
    const headers = ["เลขที่", "ชื่อ", "คะแนน", "สถานะ"];
    const rows = activeSubject.results.map(r => [
      r.studentNumber,
      r.studentName,
      r.totalScore,
      r.hasError ? "มีข้อผิดพลาด" : "ปกติ"
    ]);
    
    let csvContent = "\uFEFF" + headers.join(",") + "\n";
    rows.forEach(row => { csvContent += row.join(",") + "\n"; });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `results_${activeSubject.name}.csv`);
    link.click();
  };

  return (
    <div className="min-h-screen pb-20">
      <Navbar />

      <main className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Error Alert */}
        {errorMessage && (
          <div className="mb-6 bg-amber-50 border-l-4 border-amber-500 p-4 rounded-xl flex items-start gap-3 animate-fadeIn shadow-sm">
            <div className="bg-amber-100 p-2 rounded-lg text-amber-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
            </div>
            <div className="flex-1">
              <p className="font-bold text-amber-800 text-sm">ข้อมูลระบบ</p>
              <p className="text-amber-700 text-xs">{errorMessage}</p>
            </div>
            <button onClick={() => setErrorMessage(null)} className="ml-auto text-amber-400 hover:text-amber-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        )}

        {/* WIZARD PROGRESS BAR */}
        {currentStep !== AppStep.SUBJECT_LIST && (
           <div className="mb-8 flex items-center justify-between bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
              <button 
                onClick={() => { setCurrentStep(AppStep.SUBJECT_LIST); setErrorMessage(null); }}
                className="flex items-center gap-1 text-gray-500 hover:text-blue-600 transition px-3 py-1.5 rounded-lg hover:bg-blue-50"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span className="font-bold text-sm">กลับ</span>
              </button>
              <div className="flex gap-2.5">
                {[1, 2, 3, 4].map(i => (
                   <div key={i} className={`h-2.5 rounded-full transition-all duration-500 ${
                     (i === 1 && currentStep === AppStep.SETUP_SUBJECT) ||
                     (i === 2 && currentStep === AppStep.CALIBRATE_KEY) ||
                     (i === 3 && currentStep === AppStep.SCAN_STUDENTS) ||
                     (i === 4 && currentStep === AppStep.VIEW_RESULTS) 
                     ? 'w-8 bg-blue-600' : 'w-2.5 bg-gray-200'
                   }`} />
                ))}
              </div>
              <div className="w-10"></div>
           </div>
        )}

        {/* LOADING OVERLAY */}
        {isLoading && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex flex-col items-center justify-center text-white p-6 text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full border-4 border-blue-400/20 animate-ping"></div>
              <div className="animate-spin rounded-full h-24 w-24 border-t-4 border-blue-400 shadow-2xl"></div>
            </div>
            <p className="text-2xl font-black mb-4 tracking-tight">กำลังประมวลผลด้วย AI...</p>
            {processingProgress.total > 0 && (
              <div className="w-full max-w-xs space-y-4">
                <div className="flex justify-between text-sm font-bold text-blue-200 uppercase tracking-widest">
                  <span>แผ่นที่ {processingProgress.current} / {processingProgress.total}</span>
                  <span>{Math.round((processingProgress.current / processingProgress.total) * 100)}%</span>
                </div>
                <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden border border-white/5 shadow-inner">
                  <div className="h-full bg-blue-500 transition-all duration-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]" style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}></div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* VIEWS */}
        {currentStep === AppStep.SUBJECT_LIST && (
          <section className="space-y-6 animate-fadeIn">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-2xl font-black text-gray-800">รายวิชาของฉัน</h2>
              <button 
                onClick={() => { setCurrentStep(AppStep.SETUP_SUBJECT); setErrorMessage(null); }}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3.5 rounded-2xl font-black shadow-lg shadow-blue-100 active:scale-95 transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                สร้างรายวิชาใหม่
              </button>
            </div>

            {subjects.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-gray-200 rounded-[2rem] p-16 text-center text-gray-400 shadow-sm">
                <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
                   <svg className="w-10 h-10 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                </div>
                <p className="text-lg font-bold text-gray-500">ยังไม่มีรายวิชา</p>
                <p className="text-sm font-medium opacity-70 mt-1">เริ่มต้นสร้างรายวิชาเพื่อใช้งาน</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {subjects.map(s => (
                  <div key={s.id} className="bg-white p-6 rounded-[2rem] shadow-sm border border-gray-100 hover:shadow-xl hover:border-blue-100 transition-all duration-300 group relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-bl-full -z-0 opacity-40 group-hover:scale-150 transition-transform duration-500"></div>
                    <div className="relative z-10">
                      <div className="flex justify-between items-start mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-black text-gray-800 group-hover:text-blue-600 transition-colors leading-tight">{s.name}</h3>
                          <div className="flex gap-3 mt-2">
                            <span className="text-gray-500 text-[10px] font-black uppercase flex items-center gap-1 bg-gray-50 px-2 py-0.5 rounded-full">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" strokeWidth="2.5"/></svg>
                              {s.totalQuestions} ข้อ
                            </span>
                            <span className="text-gray-500 text-[10px] font-black uppercase flex items-center gap-1 bg-blue-50/50 px-2 py-0.5 rounded-full text-blue-600/80">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" strokeWidth="2.5"/></svg>
                              {s.results.length} แผ่น
                            </span>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); deleteSubject(s.id); }} className="text-gray-300 hover:text-red-500 transition-all p-2 rounded-xl hover:bg-red-50">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1-1v3M4 7h16"/></svg>
                        </button>
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.VIEW_RESULTS); setErrorMessage(null); }}
                          className="flex-1 bg-gray-50 hover:bg-gray-100 text-gray-700 py-2.5 rounded-xl text-xs font-black uppercase transition shadow-sm border border-gray-100"
                        >
                          สรุปผล
                        </button>
                        <button 
                          onClick={() => { setActiveSubject(s); setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }}
                          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-xs font-black uppercase transition shadow-md shadow-blue-100"
                        >
                          เริ่มตรวจ
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {currentStep === AppStep.SETUP_SUBJECT && (
          <section className="bg-white p-8 sm:p-10 rounded-[2.5rem] shadow-xl border border-gray-100 max-w-lg mx-auto animate-fadeIn relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-blue-600"></div>
            <h2 className="text-2xl font-black mb-1 text-gray-800">สร้างรายวิชา</h2>
            <p className="text-gray-400 text-xs mb-8 font-bold uppercase tracking-widest">Setup new subject</p>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              handleCreateSubject(formData.get('name') as string, parseInt(formData.get('count') as string));
            }}>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">ชื่อรายวิชา</label>
                  <input required name="name" type="text" placeholder="เช่น วิทยาศาสตร์ ม.3" className="w-full px-5 py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium" />
                </div>
                <div>
                  <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">จำนวนข้อสอบ</label>
                  <div className="relative">
                    <input required name="count" type="number" min="1" max="100" placeholder="ระบุจำนวนข้อ" className="w-full px-5 py-4 rounded-2xl border border-gray-200 focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-bold text-lg pr-12" />
                    <span className="absolute right-5 top-1/2 -translate-y-1/2 text-gray-300 font-black">ข้อ</span>
                  </div>
                </div>
                <button type="submit" className="w-full bg-blue-600 text-white py-4.5 rounded-2xl font-black text-lg shadow-xl shadow-blue-100 hover:bg-blue-700 transition active:scale-[0.98] mt-4 uppercase tracking-wider">
                  สร้างและไปต่อ
                </button>
              </div>
            </form>
          </section>
        )}

        {currentStep === AppStep.CALIBRATE_KEY && activeSubject && (
          <section className="space-y-10 animate-fadeIn text-center">
            <div className="max-w-md mx-auto">
              <h2 className="text-3xl font-black mb-3 text-gray-800 leading-tight">ระบุเฉลยที่ถูกต้อง</h2>
              <p className="text-gray-500 mb-10 text-sm font-medium">เลือกเฉลยด้วยตนเองด้านล่าง หรือใช้ภาพช่วยอ่านเฉลยอัตโนมัติ (AI)</p>
              
              <div className="relative group overflow-hidden rounded-[3rem] h-64 shadow-2xl shadow-blue-50 mb-10">
                <input 
                  type="file" 
                  accept="image/*" 
                  className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                  onChange={(e) => e.target.files && processKeyImage(e.target.files[0])}
                />
                <div className="border-4 border-dashed border-blue-50 group-hover:border-blue-300 rounded-[3rem] p-8 transition-all duration-300 bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                  <div className="bg-blue-600 p-5 rounded-[2rem] mb-4 text-white shadow-lg shadow-blue-100 group-hover:scale-110 transition-transform">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                  </div>
                  <span className="text-lg font-black text-gray-700 block">อัปโหลดภาพเฉลย (AI)</span>
                  <span className="text-[10px] text-gray-300 mt-2 font-black uppercase tracking-widest italic">AI feature: Detect answers from photo</span>
                </div>
              </div>
            </div>

            <div className="bg-white p-8 rounded-[3rem] shadow-xl border border-gray-50 text-left animate-slideUp">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-2 h-8 bg-blue-600 rounded-full"></div>
                <h3 className="text-xl font-black text-gray-800">จัดการเฉลย ({activeSubject.totalQuestions} ข้อ)</h3>
              </div>
              
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
                {activeSubject.answerKey.map((ans, idx) => (
                  <div key={idx} className="flex flex-col items-center p-3 rounded-2xl bg-gray-50 border border-gray-100 hover:bg-white hover:shadow-md transition-all cursor-pointer">
                    <span className="text-[10px] text-gray-400 font-black mb-1">ข้อ {idx + 1}</span>
                    <select 
                      value={ans || ''} 
                      onChange={(e) => {
                        const newKey = [...activeSubject.answerKey];
                        newKey[idx] = (e.target.value as Choice) || null;
                        const updated = { ...activeSubject, answerKey: newKey };
                        setActiveSubject(updated);
                        setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                      }}
                      className="bg-transparent font-black text-blue-600 outline-none text-center appearance-none cursor-pointer w-full text-lg"
                    >
                      <option value="">-</option>
                      <option value="ก">ก</option>
                      <option value="ข">ข</option>
                      <option value="ค">ค</option>
                      <option value="ง">ง</option>
                    </select>
                  </div>
                ))}
              </div>
              
              <button 
                onClick={() => { setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }}
                className="mt-10 w-full bg-blue-600 text-white py-5 rounded-[1.5rem] font-black text-lg shadow-xl shadow-blue-100 hover:bg-blue-700 transition active:scale-[0.98] flex items-center justify-center gap-3"
              >
                บันทึกและไปขั้นตอนถัดไป
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </button>
            </div>
          </section>
        )}

        {currentStep === AppStep.SCAN_STUDENTS && activeSubject && (
          <section className="space-y-10 animate-fadeIn text-center">
            <div className="max-w-lg mx-auto">
              <h2 className="text-3xl font-black mb-3 text-gray-800">ตรวจแผ่นนักเรียน</h2>
              <p className="text-gray-500 mb-10 text-sm font-medium leading-relaxed">ใช้ AI ช่วยตรวจจับจากภาพถ่าย <br/>หรือข้ามไปหน้าสรุปผลเพื่อบันทึกคะแนนด้วยตนเอง</p>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="relative group overflow-hidden rounded-[2.5rem] h-64 shadow-xl hover:shadow-2xl transition-all duration-300">
                  <input 
                    type="file" 
                    accept="image/*" 
                    capture="environment"
                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                    onChange={(e) => e.target.files && processStudentImages(e.target.files)}
                  />
                  <div className="border-2 border-blue-50 group-hover:border-blue-400 rounded-[2.5rem] p-8 transition bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                    <div className="bg-blue-600 p-5 rounded-3xl mb-4 text-white shadow-lg group-hover:rotate-12 transition-transform">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" strokeWidth="2.5"/></svg>
                    </div>
                    <span className="text-xl font-black text-gray-800">ตรวจด้วย AI</span>
                  </div>
                </div>

                <div className="relative group overflow-hidden rounded-[2.5rem] h-64 shadow-xl hover:shadow-2xl transition-all duration-300">
                  <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    className="absolute inset-0 opacity-0 cursor-pointer z-10 w-full h-full" 
                    onChange={(e) => e.target.files && processStudentImages(e.target.files)}
                  />
                  <div className="border-2 border-gray-50 group-hover:border-blue-300 rounded-[2.5rem] p-8 transition bg-white pointer-events-none h-full flex flex-col items-center justify-center">
                    <div className="bg-gray-100 p-5 rounded-3xl mb-4 text-gray-600 shadow-md group-hover:-rotate-12 transition-transform">
                      <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    </div>
                    <span className="text-xl font-black text-gray-800">เลือกภาพมาตรวจ</span>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <button 
                  onClick={() => setCurrentStep(AppStep.VIEW_RESULTS)}
                  className="text-blue-600 font-bold hover:underline"
                >
                  หรือ ป้อนคะแนนด้วยตนเอง (Manual)
                </button>
              </div>
            </div>
          </section>
        )}

        {currentStep === AppStep.VIEW_RESULTS && activeSubject && (
          <section className="space-y-8 animate-fadeIn pb-24">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div>
                <h2 className="text-4xl font-black text-gray-800 tracking-tight leading-none">{activeSubject.name}</h2>
                <div className="flex items-center gap-3 mt-3">
                   <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-widest">Scoreboard</span>
                   <span className="text-xs font-bold text-gray-400">เฉลี่ย {activeSubject.results.length > 0 ? (activeSubject.results.reduce((a,b) => a + b.totalScore, 0) / activeSubject.results.length).toFixed(1) : 0} คะแนน</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 w-full md:w-auto">
                <button onClick={() => {
                   const newRes: StudentResult = {
                     id: Date.now().toString(),
                     studentNumber: (activeSubject.results.length + 1).toString(),
                     studentName: "รายชื่อใหม่",
                     answers: activeSubject.answerKey.map((ans, i) => ({ questionNo: i+1, studentAnswer: null, correctAnswer: ans, isCorrect: false })),
                     totalScore: 0,
                     hasError: false
                   };
                   const updated = { ...activeSubject, results: [...activeSubject.results, newRes] };
                   setActiveSubject(updated);
                   setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                }} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-6 py-4 rounded-2xl font-black text-sm uppercase">
                  เพิ่มคน
                </button>
                <button onClick={exportToCSV} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-green-50 text-sm uppercase">
                  ส่งออก CSV
                </button>
                <button onClick={() => { setCurrentStep(AppStep.SCAN_STUDENTS); setErrorMessage(null); }} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-2xl font-black shadow-lg shadow-blue-50 text-sm uppercase">
                  ตรวจต่อ
                </button>
              </div>
            </div>

            <div className="bg-white rounded-[2.5rem] shadow-xl border border-gray-50 overflow-hidden overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50/50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                    <th className="px-8 py-5">เลขที่</th>
                    <th className="px-8 py-5">ชื่อ-นามสกุล</th>
                    <th className="px-8 py-5 text-center">คะแนนรวม</th>
                    <th className="px-8 py-5 text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {activeSubject.results.map((r, idx) => (
                    <tr key={r.id} className="hover:bg-blue-50/20 transition-all duration-300">
                      <td className="px-8 py-5">
                         <input value={r.studentNumber} onChange={(e) => {
                            const newResults = [...activeSubject.results];
                            newResults[idx].studentNumber = e.target.value;
                            const updated = { ...activeSubject, results: newResults };
                            setActiveSubject(updated);
                            setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                          }} className="w-16 bg-transparent border-b-2 border-transparent focus:border-blue-500 outline-none p-1 font-black text-gray-800" />
                      </td>
                      <td className="px-8 py-5">
                         <input value={r.studentName} onChange={(e) => {
                            const newResults = [...activeSubject.results];
                            newResults[idx].studentName = e.target.value;
                            const updated = { ...activeSubject, results: newResults };
                            setActiveSubject(updated);
                            setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                          }} className="w-full max-w-xs bg-transparent border-b-2 border-transparent focus:border-blue-500 outline-none p-1 font-bold text-gray-700" />
                      </td>
                      <td className="px-8 py-5 text-center">
                        <div className="inline-flex items-center gap-2">
                           <input 
                             type="number"
                             value={r.totalScore}
                             onChange={(e) => {
                                const newResults = [...activeSubject.results];
                                newResults[idx].totalScore = parseInt(e.target.value) || 0;
                                const updated = { ...activeSubject, results: newResults };
                                setActiveSubject(updated);
                                setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                             }}
                             className="w-16 text-center bg-blue-50 text-blue-700 rounded-lg font-black text-lg py-1 border-none outline-none"
                           />
                           <span className="text-[10px] text-gray-400">/ {activeSubject.totalQuestions}</span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <button onClick={() => {
                          const newResults = activeSubject.results.filter(res => res.id !== r.id);
                          const updated = { ...activeSubject, results: newResults };
                          setActiveSubject(updated);
                          setSubjects(subjects.map(s => s.id === updated.id ? updated : s));
                        }} className="text-gray-300 hover:text-red-500 transition-all p-2 rounded-xl hover:bg-red-50">
                           <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <footer className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-xl border-t border-gray-100 p-4 text-center z-40 flex flex-col sm:flex-row items-center justify-between px-8">
        <div className="flex items-center gap-2">
           <span className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-300">TODSUAB • SMART OMR</span>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={handleOpenKeySelector}
            className={`flex items-center gap-2 font-black text-[10px] uppercase tracking-widest px-4 py-1.5 rounded-full shadow-sm ${isApiKeySelected ? 'text-green-600 bg-green-50' : 'text-amber-600 bg-amber-50'}`}
          >
            <span className={`w-2 h-2 rounded-full ${isApiKeySelected ? 'bg-green-500' : 'bg-gray-300'}`}></span>
            AI Mode: {isApiKeySelected ? 'Active' : 'Offline (Setup for AI Scan)'}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
