
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
  // ค้นหา JSON block โดยละเอียดที่สุด
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  return text.replace(/```json/g, "").replace(/```/g, "").trim();
};

const mapToChoice = (val: any): Choice => {
  if (val === null || val === undefined || val === "") return null;
  const v = String(val).trim().toUpperCase();
  
  // รองรับการ Map ทุกรูปแบบที่ AI อาจจะส่งมา (ตัวเลข 1-4, ก-ง, A-D)
  if (['1', 'ก', 'A', 'COL1', 'COLUMN1', 'ONE'].includes(v)) return 'ก';
  if (['2', 'ข', 'B', 'COL2', 'COLUMN2', 'TWO'].includes(v)) return 'ข';
  if (['3', 'ค', 'C', 'COL3', 'COLUMN3', 'THREE'].includes(v)) return 'ค';
  if (['4', 'ง', 'D', 'COL4', 'COLUMN4', 'FOUR'].includes(v)) return 'ง';
  
  if (['MULTIPLE', 'M', 'ERR', 'ERROR', 'X', 'MANY'].includes(v)) return 'multiple';
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
      return { answers: [], error: "กรุณาเชื่อมต่อ API Key ก่อน", isAuthError: true };
    }

    const ai = new GoogleGenAI({ apiKey });
    
    // แยก Instruction สำหรับเฉลย และสำหรับนักเรียน เพื่อความแม่นยำสูงสุด
    const roleInstruction = isKey 
      ? "You are a specialized Answer Key Scanner." 
      : "You are a specialized Student Answer Sheet Scanner.";

    const taskDetail = isKey
      ? `Scan the grid for exactly ${totalQuestions} questions. Focus only on the most clearly marked bubble in each row.`
      : `Scan the grid for ${totalQuestions} questions. Identify the darkest marked bubble in each row. Also, look for any handwritten student ID or name in the header section.`;

    const systemInstruction = `${roleInstruction}
Goal: Extract markings from an OMR grid.
${taskDetail}
Grid Layout: Horizontal rows (Question IDs) and 4 columns (1=ก, 2=ข, 3=ค, 4=ง).

Rules:
1. Return exactly ${totalQuestions} question objects in an array.
2. For each question, if a bubble is shaded, return its index "1", "2", "3", or "4".
3. If no mark is found, return null.
4. If multiple bubbles are shaded in one row, return "multiple".
5. Output MUST be valid JSON only.

Format:
{
  "questions": [{"id": 1, "marked": "1"}, {"id": 2, "marked": null}],
  ${!isKey ? '"studentNumber": "string if found", "studentName": "string if found"' : ''}
}`;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/jpeg", data: base64Image.split(',')[1] } },
          { text: `Grading request: Extract data for questions 1 to ${totalQuestions}.` }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        temperature: 0,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
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

    if (!response || !response.text) {
      throw new Error("No response from Gemini");
    }
    
    const text = response.text;
    const cleanData = cleanJsonResponse(text);
    const data = JSON.parse(cleanData);
    
    const answers: Choice[] = new Array(totalQuestions).fill(null);
    
    if (data.questions && Array.isArray(data.questions)) {
      data.questions.forEach((q: any) => {
        const idVal = parseInt(String(q.id));
        const idx = idVal - 1;
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
    console.error("OMR Scanning Exception:", err);
    // แจ้งเตือนที่มีข้อมูลเป็นประโยชน์มากขึ้นแก่ครู
    const errorMsg = isKey 
      ? "AI ไม่สามารถอ่านใบเฉลยได้ กรุณาวางใบเฉลยให้ตรงและไม่มีแสงสะท้อน" 
      : "AI ไม่สามารถอ่านใบงานนักเรียนแผ่นนี้ได้ อาจเกิดจากภาพสั่นหรือมีเงาพาดทับกระดาษ กรุณาถ่ายใหม่อีกครั้ง";
    
    return { 
      answers: [], 
      error: errorMsg
    };
  }
};
