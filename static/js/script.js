function createMessageElement() {
    const output = document.querySelector("#gpt-output");
    const template = document.querySelector("#chat-template");

    if (!output || !template) {
        throw new Error("Éléments HTML du chat introuvables.");
    }

    const clone = template.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.remove("hidden");
    output.appendChild(clone);

    return clone.querySelector(".message");
}

function appendMessage(message, role = "assistant") {
    const element = createMessageElement();

    element.dataset.role = role;
    element.textContent = message;

    if (role === "user") {
        element.parentElement.classList.add(
            "border-indigo-200",
            "bg-indigo-50"
        );
    }

    return element;
}

function getChatHistory() {
    return Array.from(
        document.querySelectorAll("#gpt-output .message")
    ).map(element => ({
        role: element.dataset.role,
        content: element.innerText.trim()
    })).filter(message => message.content.length > 0);
}

async function fetchPromptResponse(messages, domain) {
    const response = await fetch("/prompt", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages, domain })
    });

    if (!response.ok) {
        let message = `Erreur HTTP ${response.status}`;

        try {
            const data = await response.json();
            if (data.error) message = data.error;
        } catch (_) {}

        throw new Error(message);
    }

    if (!response.body) {
        throw new Error("Le serveur n'a retourné aucun flux.");
    }

    return response.body.getReader();
}

async function readResponseChunks(reader, output) {
    const decoder = new TextDecoder("utf-8");
    const converter = new showdown.Converter();
    let text = "";

    try {
        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            text += decoder.decode(value, { stream: true });

            output.innerHTML = DOMPurify.sanitize(
                converter.makeHtml(text)
            );
        }

        text += decoder.decode();

        output.innerHTML = DOMPurify.sanitize(
            converter.makeHtml(text)
        );

        if (window.hljs) {
            output.querySelectorAll("pre code").forEach(block => {
                window.hljs.highlightElement(block);
            });
        }

        return text;
    } finally {
        reader.releaseLock();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const form = document.querySelector("#prompt-form");
    const input = document.querySelector("#prompt");
    const button = form?.querySelector('button[type="submit"]');
    const domainSelect = document.querySelector("#domain");
    const newChatButton = document.querySelector("#new-chat");
    const output = document.querySelector("#gpt-output");
    const status = document.querySelector("#status");

    if (
        !form || !input || !button || !domainSelect ||
        !newChatButton || !output || !status
    ) {
        console.error("Un ou plusieurs éléments HTML sont introuvables.");
        return;
    }

    let busy = false;

    newChatButton.addEventListener("click", () => {
        if (busy) return;

        output.replaceChildren();
        input.value = "";
        status.textContent = "Nouvelle conversation démarrée.";
        input.focus();
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();

        const question = input.value.trim();

        if (!question || busy) return;

        busy = true;
        button.disabled = true;
        newChatButton.disabled = true;
        domainSelect.disabled = true;
        input.disabled = true;

        appendMessage(question, "user");
        input.value = "";
        status.textContent = "L'assistant réfléchit...";

        try {
            const messages = getChatHistory();
            const reader = await fetchPromptResponse(
                messages,
                domainSelect.value
            );

            const answer = appendMessage("", "assistant");
            const result = await readResponseChunks(reader, answer);

            if (!result.trim()) {
                answer.textContent =
                    "L'assistant a retourné une réponse vide.";
                status.textContent = "Réponse vide.";
            } else {
                status.textContent = "Réponse terminée.";
            }
        } catch (error) {
            console.error("Erreur FlaskGPT :", error);

            appendMessage(
                `Erreur : ${error.message}`,
                "assistant"
            );

            status.textContent = "Échec de la génération.";
        } finally {
            busy = false;
            button.disabled = false;
            newChatButton.disabled = false;
            domainSelect.disabled = false;
            input.disabled = false;
            input.focus();
        }
    });
});
