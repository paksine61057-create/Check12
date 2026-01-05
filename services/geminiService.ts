
import { GoogleGenAI, Type } from "@google/genai";
import { Choice } from "../types";

const getSafeApiKey = (): string => {
  let key = "";
  try {
    const envKey = (typeof process !== 'undefined' && process.env?.API_KEY) ? process.env.API_KEY : "";
    const windowKey = (window as any).API_KEY || "";
    const manualKey = localStorage.getItem('manual_api_key') || "";
    key = envKey || windowKey || manualKey || "";
  } catch (e) {
    key = localStorage.getItem('manual_api_key') || (window as any).API_KEY || "";
  }
  return key.toString().trim().replace(/^['"]|['"]$/g, '');
};

const cleanJsonResponse = (text: string): string => {
  if (!text) return "";
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1) return text.substring(start, end + 1);
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined) return null;
  const v = String(val).trim().toUpperCase();
  // แมปตามตำแหน่งที่ AI ส่งมา หรือตัวอักษร
  if (v === 'ก' || v === 'A' || v === '1' || v === 'COL1') return 'ก';
  if (v === 'ข' || v === 'B' || v === '2' || v === 'COL2') return 'ข';
  if (v === 'ค' || v === 'C' || v === '3' || v === 'COL3') return 'ค';
  if (v === 'ง' || v === 'D' || v === '4' || v === 'COL4') return 'ง';
  if (v === 'MULTIPLE' || v === 'M') return 'multiple';
  return null;
};

export const analyzeAnswerSheet = async (
  base64Image: string,
  totalQuestions: number,
  isKey: boolean = false
): Promise<{ 
  answers: Choice[], 
  studentId?: string, 
  studentName?: string,
  error?: string,
  isAuthError?: boolean
}> => {
  try {
    const apiKey = getSafeApiKey();
    if (!apiKey || apiKey.length < 5) {
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อนใช้งาน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // ปรับ Instruction ให้เน้น "ตำแหน่งในตาราง" ตามที่คุณต้องการ
    const systemInstruction = `You are an OMR Grid Reader. 
The image is a grid of answers from question 1 to ${totalQuestions}.
Layout rules:
- Each row is a Question ID.
- Each row has 4 columns representing choices: ก(1), ข(2), ค(3), ง(4).
- Task: Identify which column is marked (tick, cross, or shaded) in each row.
- If multiple marks in a row, use "multiple". If empty, use null.
- For student sheets, also extract "studentNumber" and "studentName" from the top part.
Return ONLY valid JSON.`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: isKey 
            ? `Scan Answer Key for ${totalQuestions} questions. Identify marks in 4 columns.` 
            : `Scan Student Paper for ${totalQuestions} questions. Identify marks and student info.` 
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 }, // ปิด Thinking เพื่อเลี่ยง Error
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.INTEGER },
                  marked: { type: Type.STRING, nullable: true }
                },
                required: ["id", "marked"]
              }
            },
            studentNumber: { type: Type.STRING },
            studentName: { type: Type.STRING }
          },
          required: ["questions"]
        }
      }
    });

    const responseText = response.text;
    if (!responseText) throw new Error("Empty Response");
    
    const data = JSON.parse(cleanJsonResponse(responseText));
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    // เติมข้อมูลลง Array ให้ตรงตามข้อ
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idx = q.id - 1;
        if (idx >= 0 && idx < totalQuestions) {
          answers[idx] = mapToChoice(q.marked);
        }
      });
    }

    return {
      answers,
      studentId: data.studentNumber || "",
      studentName: data.studentName || ""
    };
  } catch (err: any) {
    console.error("OMR Logic Error:", err);
    return { 
      answers: [], 
      error: "AI ประมวลผลภาพไม่สำเร็จ กรุณาลองใหม่ในที่สว่างหรือถ่ายให้เห็นตารางคำตอบชัดเจน", 
      isAuthError: err.message?.includes("401") || err.message?.includes("API_KEY")
    };
  }
};
