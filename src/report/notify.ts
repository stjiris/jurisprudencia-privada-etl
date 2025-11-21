import { createTransport } from "nodemailer";
import { Report } from "./report";
import { envOrFail } from "../aux";

export function getMailConfig() {
    return {
        host: envOrFail("MAIL_HOST"),
        user: envOrFail("MAIL_USER"),
        pass: envOrFail("MAIL_PASS"),
        from: envOrFail("MAIL_FROM"),
        to: envOrFail("MAIL_TO").split(",")
    }
}

export function notify(report: Report) {
    let config: ReturnType<typeof getMailConfig>;
    try {
        config = getMailConfig();
    }
    catch (e) {
        console.error(e);
        return;
    }
    let transporter = createTransport({
        host: config.host,
        secure: true,
        auth: {
            user: config.user,
            pass: config.pass
        }
    });

    // send mail with defined transport object
    transporter.sendMail({
        from: config.from,
        to: config.to,
        subject: `Relatório de atualização da "${report.target}"`,
        html: `
<p>Relatório de atualização da "${report.target}" em modo <b>${report.soft ? "rápido" : "completo"}</b>.
Iniciado em ${report.dateStart.toISOString()} e terminado em ${report.dateEnd.toISOString()} (duração: ${report.dateEnd.getTime() - report.dateStart.getTime()}ms).</p>
<table>
    <tr>
        <th>Operação</th>
        <th>Quantidade</th>
    </tr>
    <tr>
        <td>Criados</td>
        <td>${report.created}</td>
    </tr>
    <tr>
        <td>Atualizados</td>
        <td>${report.updated}</td>
    </tr>
    <tr>
        <td>Eliminados</td>
        <td>${report.deleted}</td>
    </tr>
    <tr>
        <td>Ignorados</td>
        <td>${report.skiped}</td>
    </tr>
</table>
`   }, (err, info) => {
        if (err) {
            console.error(config)
            console.error(err);
        }
        else {
            console.error(info);
        }
    });
}
